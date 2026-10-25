from fastapi import APIRouter, HTTPException

from app import destinations, settings
from app.config import Destination, load_config, save_config
from app.hub import hub

router = APIRouter(prefix="/destinations", tags=["destinations"])


@router.post("/test")
async def test(dest: Destination) -> dict:
    """Ask the destination who this token is, with the settings as they are on the page, saved or not."""
    try:
        return await destinations.hello(dest)
    except destinations.DestinationError as e:
        raise HTTPException(502, str(e)) from e


@router.post("/{name}/older")
def send_older(name: str) -> dict:
    """"Send older passes": automatic sending takes every pass on the Pi, not only those finished since it
    was switched on. Answers how many are not on the destination yet."""
    config = load_config(settings.CONFIG_FILE)
    dest = config.destination(name)
    if dest is None:
        raise HTTPException(404, "no such destination; save the settings first")
    if not dest.automatic:
        raise HTTPException(409, f"sending to {name} isn't automatic; save it as automatic first")
    dest.since = 0
    save_config(settings.CONFIG_FILE, config)
    hub.publish("config", config.model_dump())
    return {"queued": destinations.queued(settings.PASSES_DIR, dest)}
