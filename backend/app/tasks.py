"""Background jobs that run for the app's lifetime."""

import asyncio
import logging
import time

import httpx

from app import settings
from app.passes import output_busy
from app.supervisor import supervisor

log = logging.getLogger(__name__)

http = httpx.AsyncClient(timeout=5)

POLL_INTERVAL = 2
HOUSEKEEPING_INTERVAL = 15
DAILY_RESTART = 24 * 3600   # SatDump only refreshes its orbit data (TLEs) when it starts


class Tracker:
    """The last status read from SatDump's own web server (/api)."""

    def __init__(self) -> None:
        self.data: dict | None = None
        self.updated_at = 0.0

    def in_pass(self) -> bool:
        t = (self.data or {}).get("object_tracker") or {}
        return not t.get("next_event_is_aos", True) and t.get("next_los_time", 0) > time.time()


tracker = Tracker()


async def poll_tracker() -> None:
    while True:
        if supervisor.state == "running":
            try:
                r = await http.get(f"http://{settings.SATDUMP_HTTP}/api")
                r.raise_for_status()
                tracker.data, tracker.updated_at = r.json(), time.time()
            except (httpx.HTTPError, ValueError):
                pass                        # still starting up; the page shows how old the data is
        else:
            tracker.data = None
        await asyncio.sleep(POLL_INTERVAL)


def safe_to_restart() -> bool:
    return not tracker.in_pass() and not output_busy(settings.PASSES_DIR)


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
