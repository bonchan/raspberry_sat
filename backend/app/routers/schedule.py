import asyncio

from fastapi import APIRouter

from app import settings
from app.config import load_config
from app.orbits import load_tles, schedule

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


@router.get("/tles")
async def get_tles() -> dict:
    """The station and the orbit data (TLEs) of the satellites in the settings, from SatDump's file:
    the Live page's globe works out where they are from these."""
    config = load_config(settings.CONFIG_FILE)
    try:
        tles = await asyncio.to_thread(load_tles, settings.SATDUMP_TLES)
    except OSError:
        tles = {}                   # SatDump has not downloaded them yet
    return {
        "station": config.station.model_dump(),
        "satellites": [
            {"name": s.name or tles[s.norad][0], "norad": s.norad, "enabled": s.enabled,
             "line1": tles[s.norad][1], "line2": tles[s.norad][2]}
            for s in config.satellites if s.norad in tles
        ],
        "missing": [s.name or str(s.norad) for s in config.satellites if s.norad not in tles],
    }
