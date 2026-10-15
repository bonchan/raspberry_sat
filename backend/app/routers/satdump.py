import time
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app import settings
from app.config import load_config
from app.satdump_cfg import build_autotrack_config
from app.supervisor import supervisor
from app.tasks import http, tracker

router = APIRouter(tags=["satdump"])


@router.get("/status")
def get_status() -> dict:
    return {
        "satdump": supervisor.snapshot(),
        "tracker": tracker.data,
        "tracker_age": time.time() - tracker.updated_at if tracker.data else None,
        "in_pass": tracker.in_pass(),
    }


@router.post("/satdump/{action}")
async def control(action: Literal["start", "stop", "restart"]) -> dict:
    if action == "start":
        await supervisor.start()
    elif action == "stop":
        supervisor.in_background(supervisor.stop())
    else:
        supervisor.in_background(supervisor.restart("restart requested from the web page"))
    return supervisor.snapshot()


@router.get("/satdump/config")
def generated_config() -> dict:
    """What SatDump gets started with, from the current settings."""
    return build_autotrack_config(load_config(settings.CONFIG_FILE), settings.PASSES_DIR, settings.SATDUMP_HTTP)


@router.get("/satdump/{name}.jpeg")
async def satdump_image(name: Literal["polarplot", "schedule", "fft"]) -> Response:
    try:
        r = await http.get(f"http://{settings.SATDUMP_HTTP}/{name}.jpeg")
    except httpx.HTTPError:
        raise HTTPException(503, "SatDump is not answering")
    if r.status_code != 200 or not r.content:
        raise HTTPException(503, "SatDump has no image yet")
    return Response(r.content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
