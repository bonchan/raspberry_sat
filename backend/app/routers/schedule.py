import asyncio

from fastapi import APIRouter

from app import settings
from app.config import load_config
from app.orbits import schedule

router = APIRouter(tags=["schedule"])


@router.get("/schedule")
async def get_schedule() -> dict:
    """Passes in the next display.upcoming_days days, with sky tracks. `scheduled` = high enough for SatDump to record."""
    config = load_config(settings.CONFIG_FILE)
    return await asyncio.to_thread(schedule.get, config, settings.SATDUMP_TLES)
