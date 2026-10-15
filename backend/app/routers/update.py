import asyncio

from fastapi import APIRouter, HTTPException

from app import tasks, updater

router = APIRouter(prefix="/update", tags=["update"])


def view(state: dict | None) -> dict:
    return {**(state or {}), "running": updater.running(), "last_run": updater.last_run()}


@router.get("")
async def get_update() -> dict:
    """The last check (no network), plus whether an update is running and its log."""
    state = updater.cached() or await asyncio.to_thread(updater.check, False)
    return await asyncio.to_thread(view, state)


@router.post("/check")
async def check_now() -> dict:
    """git fetch, then compare."""
    state = await asyncio.to_thread(updater.check, True)
    return await asyncio.to_thread(view, state)


@router.post("/apply")
async def apply() -> dict:
    busy = not tasks.safe_to_restart()
    try:
        await asyncio.to_thread(updater.start, busy)
    except updater.UpdateError as e:
        raise HTTPException(409, str(e))
    return await asyncio.to_thread(view, updater.cached())
