"""Updating the app from the page: what is new upstream (git), then pull, rebuild and restart.

The update runs as its own transient systemd unit (systemd-run), not inside the app's service:
update.sh restarts that service at the end, which would otherwise kill the update halfway.
Starting the unit needs passwordless sudo for the app's user (Raspberry Pi OS gives that to the
first user); update.sh needs it anyway.
"""

import getpass
import subprocess
import time
from datetime import datetime
from pathlib import Path

from app import settings

UNIT = "raspberry_sat-update"
LOG_TAIL = 300


class UpdateError(Exception):
    pass


def git(*args: str, timeout: float = 30) -> str:
    try:
        r = subprocess.run(["git", "-C", str(settings.REPO_DIR), *args],
                           capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise UpdateError(f"git {args[0]}: {e}") from e
    if r.returncode != 0:
        raise UpdateError(r.stderr.strip() or f"git {args[0]} failed")
    return r.stdout


def commit_info(rev: str) -> dict:
    h, short, ts, subject = git("log", "-1", "--format=%H%x1f%h%x1f%ct%x1f%s", rev).strip().split("\x1f", 3)
    return {"hash": h, "short": short, "time": int(ts), "subject": subject}


def pending_commits(upstream: str) -> list[dict]:
    """Commits upstream that this checkout does not have, newest first, with the files each changes."""
    out = git("log", "--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s%x1f%b%x1e", f"HEAD..{upstream}")
    commits = []
    for record in out.split("\x1e"):
        if not record.strip():
            continue
        h, short, author, ts, subject, body = record.lstrip("\n").split("\x1f", 5)
        commits.append({"hash": h, "short": short, "author": author, "time": int(ts),
                        "subject": subject, "body": body.strip(), "files": []})

    by_hash = {c["hash"]: c for c in commits}
    for chunk in git("log", "--format=%x1e%H", "--name-status", f"HEAD..{upstream}").split("\x1e"):
        lines = [line for line in chunk.splitlines() if line.strip()]
        if lines and lines[0].strip() in by_hash:
            for line in lines[1:]:
                parts = line.split("\t")        # "M\tpath", or "R100\told\tnew" for a rename
                by_hash[lines[0].strip()]["files"].append({"status": parts[0][:1], "path": parts[-1]})
    return commits


_cache: dict = {}


def cached() -> dict | None:
    return dict(_cache) if _cache else None


def check(fetch: bool) -> dict:
    """Compare this checkout with its upstream branch; with `fetch`, ask the remote first (needs the network)."""
    result = {"checked_at": time.time(), "error": None, "current": None, "branch": None, "upstream": None,
              "behind": 0, "ahead": 0, "commits": [], "diffstat": "", "dirty": []}
    try:
        if fetch:
            git("fetch", "--quiet", "--prune", "origin", timeout=120)
        result["current"] = commit_info("HEAD")
        result["branch"] = git("rev-parse", "--abbrev-ref", "HEAD").strip()
        try:
            upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").strip()
        except UpdateError:
            upstream = None             # detached HEAD (e.g. a tag), or a branch without upstream
        result["upstream"] = upstream
        if upstream:
            result["behind"] = int(git("rev-list", "--count", f"HEAD..{upstream}"))
            result["ahead"] = int(git("rev-list", "--count", f"{upstream}..HEAD"))
            if result["behind"]:
                result["commits"] = pending_commits(upstream)
                result["diffstat"] = git("diff", "--shortstat", "HEAD", upstream).strip()
        # "XY path"; includes mode changes like a chmod +x made on the Pi
        result["dirty"] = [line[3:] for line in git("status", "--porcelain").splitlines() if line.strip()]
    except UpdateError as e:
        result["error"] = str(e)
    _cache.clear()
    _cache.update(result)
    return result


# ---------- running the update ----------

def log_path() -> Path:
    return settings.LOGS_DIR / "update.log"


def running() -> bool:
    try:
        r = subprocess.run(["systemctl", "is-active", UNIT], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.stdout.strip() in ("active", "activating")


def last_run() -> dict | None:
    """The log of the latest update (each run starts a new one) and how it ended."""
    path = log_path()
    if not path.exists():
        return None
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    result = "ok" if any(l.startswith("== done") for l in lines) else \
        "failed" if any(l.startswith("== FAILED") for l in lines) else None
    return {"log": lines[-LOG_TAIL:], "result": result, "changed_at": path.stat().st_mtime}


def start(busy: bool) -> None:
    """Start pulling and rebuilding. `busy`: SatDump is receiving or decoding a pass right now."""
    state = check(fetch=False)
    if state["error"]:
        raise UpdateError(state["error"])
    if running():
        raise UpdateError("an update is already running")
    if busy:
        raise UpdateError("SatDump is receiving or decoding a pass; update after it finishes")
    if state["dirty"]:
        raise UpdateError("the checkout on the Pi has local changes: " + ", ".join(state["dirty"]))
    if state["ahead"]:
        raise UpdateError("the Pi has commits that are not upstream; update it by hand")
    if not state["behind"]:
        raise UpdateError("already up to date")

    log = log_path()
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(f"== update requested {datetime.now():%Y-%m-%d %H:%M:%S}, "
                   f"{state['current']['short']} -> {state['commits'][0]['short']}\n", encoding="utf-8")
    cmd = [
        "sudo", "-n", "systemd-run", f"--unit={UNIT}", "--collect", "--quiet",
        f"--uid={getpass.getuser()}", f"--working-directory={settings.REPO_DIR}",
        f"--setenv=HOME={Path.home()}", f"--setenv=RSAT_DATA={settings.DATA_DIR}",
        "/bin/bash", str(settings.REPO_DIR / "scripts" / "self_update.sh"), str(log),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise UpdateError(f"could not start the update: {e}") from e
    if r.returncode != 0:
        raise UpdateError(r.stderr.strip() or "could not start the update")
