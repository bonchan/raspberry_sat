import asyncio
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app import discord, passes, settings
from app.config import load_config

router = APIRouter(prefix="/passes", tags=["passes"])

CACHE_DAY = {"Cache-Control": "max-age=86400"}


def folder_or_404(pass_id: str) -> Path:
    folder = passes.pass_dir(settings.PASSES_DIR, pass_id)
    if folder is None:
        raise HTTPException(404, "no such pass")
    return folder


def image_or_404(folder: Path, path: str) -> str:
    """The image's clean path inside the folder (no '..' tricks), for building thumbnail paths."""
    f = passes.file_in(folder, path)
    if f is None or f.suffix.lower() not in passes.IMAGE_TYPES or passes.is_ours(folder.resolve(), f):
        raise HTTPException(404, "no such image")
    return f.relative_to(folder.resolve()).as_posix()


@router.get("")
def get_passes() -> dict:
    return passes.list_passes(settings.PASSES_DIR)


@router.get("/{pass_id}")
def get_pass(pass_id: str) -> dict:
    folder = folder_or_404(pass_id)
    meta = passes.load_pass(folder)
    if meta is None:
        raise HTTPException(409, "this pass is still being received or decoded")
    meta["files"] = passes.other_files(folder)
    meta["samples"] = passes.load_samples(folder)
    return meta


@router.get("/{pass_id}/signal")
def get_signal(pass_id: str, points: int = Query(150, ge=10, le=2000)) -> dict:
    """The pass's signal samples thinned to about `points`, with its span and elevation track:
    enough for a small chart in the pass list."""
    folder = folder_or_404(pass_id)
    orbit = (passes.load_pass(folder) or {}).get("orbit") or {}
    samples = passes.load_samples(folder)
    return {
        "start": orbit.get("aos") or (samples[0]["t"] if samples else None),
        "end": orbit.get("los") or (samples[-1]["t"] if samples else None),
        "track": orbit.get("track"),
        "samples": passes.thin_samples(samples, points),
    }


@router.get("/{pass_id}/thumb/{path:path}")
def get_thumb(pass_id: str, path: str) -> FileResponse:
    folder = folder_or_404(pass_id)
    thumb = passes.thumb_path(folder, image_or_404(folder, path))
    if not thumb.is_file():
        raise HTTPException(404, "no thumbnail")
    return FileResponse(thumb, headers=CACHE_DAY)


@router.get("/{pass_id}/large/{path:path}")
async def get_large(pass_id: str, path: str) -> FileResponse:
    folder = folder_or_404(pass_id)
    large = await asyncio.to_thread(passes.large_version, folder, image_or_404(folder, path))
    return FileResponse(large, headers=CACHE_DAY)


@router.get("/{pass_id}/file/{path:path}")
def get_file(pass_id: str, path: str) -> FileResponse:
    """Any of SatDump's files as it wrote it, e.g. the full-size PNG."""
    folder = folder_or_404(pass_id)
    f = passes.file_in(folder, path)
    if f is None or passes.is_ours(folder.resolve(), f):
        raise HTTPException(404, "no such file")
    # images open in the browser, SatDump's data files download
    disposition = "inline" if f.suffix.lower() in passes.IMAGE_TYPES else "attachment"
    return FileResponse(f, filename=f.name, content_disposition_type=disposition)


@router.post("/{pass_id}/discord")
async def post_to_discord(pass_id: str) -> dict:
    """Post the pass now (the button on the pass page). Returns where and when, as noted in pass.json."""
    folder = folder_or_404(pass_id)
    if not passes.is_finished(folder):
        raise HTTPException(409, "this pass is still being received or decoded")
    config = load_config(settings.CONFIG_FILE)
    if config.discord.mode == "off":
        raise HTTPException(409, "posting to Discord is off in Settings")
    try:
        return await discord.post_pass(folder, config)
    except discord.DiscordError as e:
        raise HTTPException(502, str(e)) from e


@router.delete("/{pass_id}")
def delete_pass(pass_id: str) -> dict:
    folder = folder_or_404(pass_id)
    if not passes.is_finished(folder):
        raise HTTPException(409, "this pass is still being received or decoded")
    shutil.rmtree(folder)
    return {"deleted": pass_id}
