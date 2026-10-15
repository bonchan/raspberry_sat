import asyncio

from fastapi import APIRouter

from app import settings
from app.config import load_config
from app.orbits import schedule

router = APIRouter(tags=["schedule"])


@router.get("/schedule")
async def get_schedule(tracks: bool = True) -> dict:
    """Passes in the next display.upcoming_days days, with sky tracks. `scheduled` = high enough for SatDump to record.
    tracks=false leaves the tracks out (small clients like the ESP32 companion don't draw them)."""
    config = load_config(settings.CONFIG_FILE)
    result = await asyncio.to_thread(schedule.get, config, settings.SATDUMP_TLES)
    if not tracks:
        result = {**result, "passes": [{k: v for k, v in p.items() if k != "track"} for p in result["passes"]]}
    return result
