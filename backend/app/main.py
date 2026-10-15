"""raspberry_sat backend: the JSON API under /api, and the built frontend for everything else."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from app import settings
from app.routers import config, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="raspberry_sat")
app.include_router(config.router, prefix="/api")
app.include_router(system.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    """Files from frontend/dist; any other path gets index.html so client-side routes survive a reload."""
    if path.startswith("api/"):
        raise HTTPException(404)
    dist = settings.FRONTEND_DIST.resolve()
    if path:
        file = (dist / path).resolve()
        if file.is_file() and dist in file.parents:
            return FileResponse(file)
    index = dist / "index.html"
    if index.is_file():
        return FileResponse(index)
    return PlainTextResponse("Frontend not built yet: run scripts/update.sh", status_code=503)
