"""The WebSocket topics beyond SatDump's status and the live signal (those are in tasks.py): what the
Status, Logs, Passes, Upcoming and Settings pages show, and how far a pass is after LOS (processing.py). A producer per topic looks every few seconds while
a tab is subscribed and publishes only when something changed; a nudge (hub.nudge) makes it look right
away, as when a pass is finished or deleted. Log lines (supervisor.py) and saved settings
(routers/config.py) are published where they happen.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Any

from app import jobs, passes, processing, settings
from app.config import load_config
from app.hub import hub
from app.routers import schedule as schedule_api
from app.routers import system as system_api
from app.routers import update as update_api
from app.supervisor import supervisor

log = logging.getLogger(__name__)


def logs_snapshot() -> dict:
    return {"kind": "snapshot", "lines": [asdict(line) for line in supervisor.lines], "last": supervisor.last_seq}


def passes_list() -> Awaitable[dict]:
    return asyncio.to_thread(passes.list_passes, settings.PASSES_DIR)


def system_info() -> Awaitable[dict]:
    return asyncio.to_thread(system_api.get_system)


async def schedule_with_tracks() -> dict:
    # without when it was worked out (every few minutes): sent when the passes change, not on every recompute
    result = await schedule_api.get_schedule(True)
    return {k: v for k, v in result.items() if k != "computed_at"}


# topic: (snapshot, then every so many seconds while watched; None: published where it changes)
TOPICS: dict[str, tuple[Callable[[], Any], float | None]] = {
    "system": (system_info, 10),
    "update": (update_api.get_update, 3),
    "passes": (passes_list, 10),
    "schedule": (schedule_with_tracks, 60),
    "tles": (schedule_api.get_tles, 60),
    "processing": (processing.view, 2),
    "config": (lambda: load_config(settings.CONFIG_FILE).model_dump(), None),
    "logs": (logs_snapshot, None),
    "jobs": (jobs.view, None),          # posting and sending in progress (jobs.py publishes the changes)
}

for name, (snapshot, _) in TOPICS.items():
    hub.topic(name, snapshot)


async def keep(topic: str, every: float, make: Callable[[], Awaitable[Any]]) -> None:
    """While a tab is subscribed: make the topic's data every `every` seconds, or right away when
    nudged, and publish it when it differs from what was published last."""
    last: str | None = None
    waited = every
    while True:
        if hub.watching(topic) and (waited >= every or hub.nudged(topic)):
            waited = 0
            try:
                data = await make()
                text = json.dumps(data, sort_keys=True, default=str)
                if text != last:
                    last = text
                    hub.publish(topic, data)
            except Exception:
                log.exception("updating the topic %s failed", topic)
        await asyncio.sleep(1)
        waited += 1


def jobs() -> list[Awaitable[None]]:
    return [keep(name, every, snapshot) for name, (snapshot, every) in TOPICS.items() if every is not None]
