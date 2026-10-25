"""Posting a pass to Discord or sending it to a destination, in the background: a pass page's button answers
at once, and the work goes on when the page is left or closed. The topic "jobs" (WebSocket) says what is
running, automatic posting and sending included; a pass page follows it, shows "Posting…" / "Sending…", and
reads the pass again when its job ends: the result, or why it failed, is in pass.json.

A job is a pass and a target: "discord", or "hub:<destination name>".
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from app.hub import hub

log = logging.getLogger(__name__)

running: dict[str, dict] = {}         # "<pass id>|<target>" -> {"pass", "target", "started_at", "by_hand"}
_tasks: set[asyncio.Task] = set()     # kept, so a running task isn't garbage collected


def key(pass_id: str, target: str) -> str:
    return f"{pass_id}|{target}"


def is_running(pass_id: str, target: str) -> bool:
    return key(pass_id, target) in running


def _publish() -> None:
    hub.publish("jobs", {"running": list(running.values())})      # at once: the pages' buttons follow it


def _mark(pass_id: str, target: str, by_hand: bool) -> None:
    running[key(pass_id, target)] = {"pass": pass_id, "target": target, "started_at": time.time(), "by_hand": by_hand}
    _publish()


def _done(pass_id: str, target: str) -> None:
    running.pop(key(pass_id, target), None)
    _publish()
    hub.nudge("passes")             # the pass's notes changed: posted, sent, or why not


@asynccontextmanager
async def running_as(pass_id: str, target: str):
    """Show automatic posting or sending as a job while the block runs (unless one by hand already shows)."""
    mine = not is_running(pass_id, target)
    if mine:
        _mark(pass_id, target, by_hand=False)
    try:
        yield
    finally:
        if mine:
            _done(pass_id, target)


def start(pass_id: str, target: str, work: Callable[[], Awaitable[object]],
          expected: tuple[type[BaseException], ...] = ()) -> bool:
    """Run `work` in the background as this pass's job for `target`; False when that job is running already.
    `expected`: the errors `work` notes in pass.json itself (others are logged)."""
    if is_running(pass_id, target):
        return False
    _mark(pass_id, target, by_hand=True)        # at once, so a second click finds it

    async def run() -> None:
        try:
            await work()
        except expected:
            pass
        except Exception:
            log.exception("%s for pass %s failed", target, pass_id)
        finally:
            _done(pass_id, target)

    task = asyncio.create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


async def view() -> dict:
    """The topic "jobs": {"running": [{"pass", "target", "started_at", "by_hand"}]}."""
    return {"running": list(running.values())}
