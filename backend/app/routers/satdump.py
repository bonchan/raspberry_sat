import asyncio
import time
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app import passes, settings, spectrum
from app.config import load_config
from app.satdump_cfg import FFT_MAX, FFT_MIN, build_autotrack_config
from app.supervisor import supervisor
from app.tasks import http, tracker

router = APIRouter(tags=["satdump"])


@router.get("/status")
def get_status() -> dict:
    return {
        "satdump": supervisor.snapshot(),
        "tracker": tracker.data,
        "tracker_age": time.time() - tracker.updated_at if tracker.data else None,
        "receiving": tracker.receiving(),
        "overhead": tracker.overhead(),
    }


@router.get("/live")
def get_live(after: float = 0) -> dict:
    """The current (or last) pass as it happens: signal samples newer than `after`, the latest reading,
    data received so far. Asking keeps SatDump's status polled four times a second for a few seconds."""
    tracker.watch()
    folder = passes.active_folder(settings.PASSES_DIR)
    return {
        "receiving": tracker.receiving(),
        "pass_started": tracker.pass_started,
        "last_los": tracker.last_los,
        "history": [s for s in tracker.history if s["t"] > after],
        "current": tracker.current(),
        "folder": folder.name if folder else None,
        "cadu_bytes": passes.cadu_bytes(folder) if folder else 0,
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


@router.get("/spectrum")
async def get_spectrum() -> dict:
    """SatDump's spectrum as dB values (see spectrum.py), 512 across the band, the tuned frequency
    in the middle. SatDump only computes it while someone asks, and stops 10 s after the last time."""
    try:
        r = await http.get(f"http://{settings.SATDUMP_HTTP}/fft.jpeg")
    except httpx.HTTPError:
        raise HTTPException(503, "SatDump is not answering")
    if r.status_code != 200 or not r.content:
        raise HTTPException(503, "SatDump has no spectrum yet")
    db = await asyncio.to_thread(spectrum.trace, r.content)
    return {
        "db": db, "min": FFT_MIN, "max": FFT_MAX,
        "frequency": (tracker.data or {}).get("frequency"),
        "samplerate": load_config(settings.CONFIG_FILE).sdr.samplerate,
        "time": time.time(),
    }
