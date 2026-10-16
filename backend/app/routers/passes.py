import asyncio
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import passes, settings

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


@router.delete("/{pass_id}")
def delete_pass(pass_id: str) -> dict:
    folder = folder_or_404(pass_id)
    if not passes.is_finished(folder):
        raise HTTPException(409, "this pass is still being received or decoded")
    shutil.rmtree(folder)
    return {"deleted": pass_id}
