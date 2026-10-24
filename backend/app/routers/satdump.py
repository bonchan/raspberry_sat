from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app import settings, tasks
from app.config import load_config
from app.satdump_cfg import build_autotrack_config
from app.supervisor import supervisor
from app.tasks import http, tracker

router = APIRouter(tags=["satdump"])


@router.get("/status")
def get_status() -> dict:
    """The same as the WebSocket topic "status"; kept for clients that poll (the ESP32 companion)."""
    return tasks.status_view()


@router.get("/live")
def get_live(after: float = 0) -> dict:
    """The current (or last) pass as it happens: signal samples newer than `after`, the latest reading,
    data received so far. Asking keeps SatDump's status polled four times a second for a few seconds."""
    tracker.watch()
    return tasks.live_view(after)


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


@router.get("/spectrum")
async def get_spectrum() -> dict:
    """The same as the WebSocket topic "spectrum" (tasks.read_spectrum)."""
    try:
        return await tasks.read_spectrum()
    except tasks.NoSpectrum as e:
        raise HTTPException(503, str(e))
