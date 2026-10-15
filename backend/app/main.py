"""raspberry_sat backend: the JSON API under /api, and the built frontend for everything else."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from app import settings, tasks
from app.routers import config, logs, networks, passes, satdump, schedule, system, update
from app.supervisor import supervisor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    jobs = [asyncio.create_task(job) for job in
            (supervisor.run(), tasks.poll_tracker(), tasks.housekeeping(), tasks.scan_passes(),
             tasks.check_updates())]
    yield
    await supervisor.shutdown()             # lets SatDump finish a pass it is decoding
    for job in jobs:
        job.cancel()
    await tasks.http.aclose()


app = FastAPI(title="raspberry_sat", lifespan=lifespan)
for router in (config.router, system.router, satdump.router, logs.router, passes.router, schedule.router,
               update.router, networks.router):
    app.include_router(router, prefix="/api")


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
