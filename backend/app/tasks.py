"""Background jobs that run for the app's lifetime."""

import asyncio
import logging
import time

import httpx

from app import passes, settings, updater
from app.supervisor import supervisor

log = logging.getLogger(__name__)

http = httpx.AsyncClient(timeout=5)

POLL_INTERVAL = 1
HOUSEKEEPING_INTERVAL = 15
SCAN_INTERVAL = 30
DAILY_RESTART = 24 * 3600   # SatDump only refreshes its orbit data (TLEs) when it starts
UPDATE_CHECK_INTERVAL = 6 * 3600


SIGNAL_KEYS = ("snr", "peak_snr", "freq", "viterbi_ber", "viterbi_lock", "deframer_lock", "rs_avg")


def signal(data: dict) -> dict:
    """SNR, lock and sync from SatDump's live pipeline stats, whichever modules report them
    (for Meteor: psk_demod and ccsds_conv_concat_decoder)."""
    out = {}
    for stats in (data.get("live_pipeline") or {}).values():
        if isinstance(stats, dict):
            out.update({k: stats[k] for k in SIGNAL_KEYS if k in stats})
    return out


class Tracker:
    """The last status read from SatDump's own web server (/api), and the current pass's signal history."""

    def __init__(self) -> None:
        self.data: dict | None = None
        self.updated_at = 0.0
        self.pass_started = 0.0         # when the current or last pass began
        self.last_los = 0.0             # when the last pass ended (or SatDump stopped during one)
        self.history: list[dict] = []   # one sample per poll during the current or last pass
        self._was_receiving = False

    def overhead(self) -> bool:
        """The tracked satellite is above the horizon, whether SatDump records this pass or not."""
        t = (self.data or {}).get("object_tracker") or {}
        return not t.get("next_event_is_aos", True) and t.get("next_los_time", 0) > time.time()

    def receiving(self) -> bool:
        """SatDump is decoding or recording a pass right now. Its tracker follows every pass,
        but passes under the minimum elevation are skipped: no SDR, no pipeline, no data."""
        data = self.data or {}
        return "live_pipeline" in data or "recording" in data

    def update(self, data: dict | None) -> None:
        now = time.time()
        self.data = data
        if data is not None:
            self.updated_at = now
        receiving = self.receiving()
        if receiving and not self._was_receiving:
            self.pass_started, self.history = now, []
        if self._was_receiving and not receiving:
            self.last_los = now
        if receiving and data is not None:
            pos = (data.get("object_tracker") or {}).get("sat_current_pos") or {}
            self.history.append({"t": round(now, 1), "az": pos.get("az"), "el": pos.get("el"), **signal(data)})
        self._was_receiving = receiving


tracker = Tracker()


async def poll_tracker() -> None:
    while True:
        if supervisor.state == "running":
            try:
                r = await http.get(f"http://{settings.SATDUMP_HTTP}/api")
                r.raise_for_status()
                tracker.update(r.json())
            except (httpx.HTTPError, ValueError):
                pass                        # still starting up; the page shows how old the data is
        else:
            tracker.update(None)
        await asyncio.sleep(POLL_INTERVAL)


def safe_to_restart() -> bool:
    return not tracker.receiving() and not passes.output_busy(settings.PASSES_DIR)


async def housekeeping() -> None:
    while True:
        await asyncio.sleep(HOUSEKEEPING_INTERVAL)
        try:
            if supervisor.restart_pending and supervisor.wanted:
                if supervisor.state != "running" or safe_to_restart():
                    await supervisor.restart(supervisor.restart_reason)
            elif supervisor.state == "running" and supervisor.uptime() > DAILY_RESTART and safe_to_restart():
                await supervisor.restart("daily restart, refreshes orbit data")
        except Exception:
            log.exception("housekeeping failed")


async def check_updates() -> None:
    """git fetch now and then, so the page can say when there is something new."""
    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(updater.check, True)
        except Exception:
            log.exception("update check failed")
        await asyncio.sleep(UPDATE_CHECK_INTERVAL)


async def scan_passes() -> None:
    """Finish passes SatDump is done with: rename, thumbnails, pass.json."""
    reported: set[str] = set()          # folders whose error was already logged
    while True:
        await asyncio.sleep(SCAN_INTERVAL)
        if tracker.receiving() or time.time() - tracker.last_los < passes.SETTLE:
            continue                    # SatDump is receiving, or still decoding: leave its folders alone
        try:
            done, errors = await asyncio.to_thread(passes.finalize_ready, settings.PASSES_DIR)
        except Exception:
            log.exception("pass scan failed")
            continue
        for folder in done:
            meta = passes.load_pass(folder) or {}
            text = f"pass {folder.name} ready: {len(meta.get('images', []))} images"
            if meta.get("coverage") is not None:
                text += f", {meta['coverage']:.0%} of the main image received"
            supervisor.note("info", text)
        for name, error in errors:
            if name not in reported:
                reported.add(name)
                supervisor.note("error", f"could not finish pass {name}: {error}")
