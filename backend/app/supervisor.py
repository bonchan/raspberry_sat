"""Runs `satdump autotrack` as a child process: start, stop, restart, and keep what it prints."""

import asyncio
import json
import logging
import re
import shutil
import time
from collections import deque
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app import settings
from app.config import load_config
from app.satdump_cfg import build_autotrack_config

log = logging.getLogger(__name__)

STOP_TIMEOUT = 120          # seconds; on SIGTERM SatDump first finishes decoding the last pass
FIRST_BACKOFF = 5           # seconds before starting again after a crash, doubling up to MAX_BACKOFF
MAX_BACKOFF = 300
STABLE_RUN = 600            # a run this long resets the backoff

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SATDUMP_LINE = re.compile(r"^\[[^\]]*\]\s*\(([TDIWEC])\)\s?(.*)$")   # "[13:25:14 - 15/10/2026] (I) message"
LEVELS = {"T": "trace", "D": "debug", "I": "info", "W": "warn", "E": "error", "C": "critical"}
PY_LEVELS = {"trace": logging.DEBUG, "debug": logging.DEBUG, "info": logging.INFO,
             "warn": logging.WARNING, "error": logging.ERROR, "critical": logging.CRITICAL}


@dataclass
class LogLine:
    seq: int
    time: float
    level: str
    source: str             # "satdump", or "app" for our own notes
    text: str


def parse_line(raw: str) -> tuple[str, str]:
    """(level, text) from one line of SatDump output."""
    line = ANSI.sub("", raw).rstrip()
    m = SATDUMP_LINE.match(line)
    if m:
        return LEVELS[m.group(1)], m.group(2)
    return "info", line


class Supervisor:
    def __init__(self) -> None:
        self.lines: deque[LogLine] = deque(maxlen=3000)
        self.last_seq = 0
        self.proc: asyncio.subprocess.Process | None = None
        self.state = "stopped"              # stopped | running | stopping | waiting (after a crash) | not_installed
        self.wanted = True                  # Stop on the web page clears it until Start (or an app restart)
        self.started_at: float | None = None
        self.exit_code: int | None = None
        self.restart_pending = False        # settings changed; tasks.housekeeping restarts when no pass runs
        self.restart_reason = ""
        self._restarting = False            # the coming exit is ours: start again right away
        self._wake = asyncio.Event()
        self._file: logging.Logger | None = None
        self._tasks: set[asyncio.Task] = set()

    # ---------- log ----------

    def note(self, level: str, text: str) -> None:
        """A line from us, shown in the same log as SatDump's."""
        log.log(PY_LEVELS[level], text)
        self._add(level, "app", text)

    def _add(self, level: str, source: str, text: str) -> None:
        self.last_seq += 1
        self.lines.append(LogLine(self.last_seq, time.time(), level, source, text))
        if self._file:
            self._file.info("%-7s %-8s %s", source, level, text)

    def _open_file_log(self) -> None:
        settings.LOGS_DIR.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(settings.LOGS_DIR / "satdump.log",
                                      maxBytes=5_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        self._file = logging.getLogger("rsat.satdump_file")
        self._file.propagate = False        # SatDump's chatter goes to the file, not the journal
        self._file.setLevel(logging.INFO)
        self._file.handlers = [handler]

    # ---------- state ----------

    def uptime(self) -> float:
        return time.time() - self.started_at if self.state == "running" and self.started_at else 0.0

    def snapshot(self) -> dict:
        return {
            "state": self.state,
            "wanted": self.wanted,
            "pid": self.proc.pid if self.proc else None,
            "started_at": self.started_at if self.state == "running" else None,
            "exit_code": self.exit_code,
            "restart_pending": self.restart_pending,
            "restart_reason": self.restart_reason,
        }

    def write_config(self) -> Path:
        cfg = build_autotrack_config(load_config(settings.CONFIG_FILE), settings.PASSES_DIR, settings.SATDUMP_HTTP)
        settings.SATDUMP_DIR.mkdir(parents=True, exist_ok=True)
        settings.PASSES_DIR.mkdir(parents=True, exist_ok=True)
        path = settings.SATDUMP_DIR / "autotrack.json"
        path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        return path

    # ---------- control, called from the API ----------

    async def start(self) -> None:
        self.wanted = True
        self._wake.set()

    async def stop(self) -> None:
        self.wanted = False
        self._wake.set()
        await self._terminate()

    async def restart(self, reason: str) -> None:
        self.note("info", f"restarting SatDump: {reason}")
        self.wanted = True
        if self.proc and self.proc.returncode is None:
            self._restarting = True
            await self._terminate()
        else:
            self._wake.set()

    def request_restart(self, reason: str) -> None:
        """Restart once it will not cut a pass short (tasks.housekeeping decides when)."""
        self.restart_pending, self.restart_reason = True, reason

    def in_background(self, coro) -> None:
        """Run a slow control call (stopping can take minutes) without holding up the HTTP request."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)               # asyncio only keeps weak references to tasks
        task.add_done_callback(self._tasks.discard)

    async def shutdown(self) -> None:
        self.wanted = False
        await self._terminate()

    # ---------- the process ----------

    async def run(self) -> None:
        """For the app's lifetime: keep SatDump running while wanted, back after a crash, waiting longer each time."""
        self._open_file_log()
        backoff = FIRST_BACKOFF
        while True:
            if not self.wanted:
                self.state = "stopped"
                await self._sleep()
                continue

            binary = shutil.which(settings.SATDUMP_BIN)
            if binary is None:
                if self.state != "not_installed":
                    self.note("warn", f"'{settings.SATDUMP_BIN}' not found, is SatDump installed? Checking every minute.")
                self.state = "not_installed"
                await self._sleep(60)
                continue

            try:
                config_path = self.write_config()
                self.restart_pending = False
                self.note("info", f"starting {binary} autotrack {config_path}")
                self.proc = await asyncio.create_subprocess_exec(
                    binary, "autotrack", str(config_path),
                    # SatDump prefers a satdump_cfg.json or pipelines/ found in its working directory: keep it clean
                    cwd=settings.SATDUMP_DIR,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    limit=1 << 20,
                )
            except OSError as e:
                self.state = "waiting"
                self.note("error", f"could not start SatDump: {e}; trying again in {backoff} s")
                await self._sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
                continue

            self.state, self.started_at, self.exit_code = "running", time.time(), None
            await asyncio.gather(self._pump(self.proc.stdout), self.proc.wait())
            self.exit_code = self.proc.returncode
            ran = time.time() - self.started_at
            self.proc = None

            if self._restarting or not self.wanted:
                self._restarting = False
                backoff = FIRST_BACKOFF
                self.note("info", f"SatDump stopped (exit code {self.exit_code})")
                continue

            if ran > STABLE_RUN:
                backoff = FIRST_BACKOFF
            self.state = "waiting"
            self.note("error", f"SatDump exited with code {self.exit_code}, starting it again in {backoff} s")
            await self._sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)

    async def _pump(self, stream: asyncio.StreamReader) -> None:
        while True:
            try:
                raw = await stream.readline()
            except ValueError:              # a line longer than the limit; asyncio drops it
                continue
            if not raw:
                return
            level, text = parse_line(raw.decode("utf-8", errors="replace"))
            if text:
                self._add(level, "satdump", text)

    async def _terminate(self) -> None:
        proc = self.proc
        if proc is None or proc.returncode is not None:
            return
        self.state = "stopping"
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), STOP_TIMEOUT)
        except asyncio.TimeoutError:
            self.note("warn", f"SatDump did not stop within {STOP_TIMEOUT} s, killing it")
            proc.kill()

    async def _sleep(self, timeout: float | None = None) -> None:
        """Wait for start/stop/restart, or the timeout."""
        self._wake.clear()
        try:
            await asyncio.wait_for(self._wake.wait(), timeout)
        except asyncio.TimeoutError:
            pass


supervisor = Supervisor()
