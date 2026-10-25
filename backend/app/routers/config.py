import time

from fastapi import APIRouter

from app import settings
from app.config import Config, load_config, save_config
from app.hub import hub
from app.satdump_cfg import build_autotrack_config
from app.supervisor import supervisor

router = APIRouter(prefix="/config", tags=["config"])


def satdump_view(config: Config) -> dict:
    return build_autotrack_config(config, settings.PASSES_DIR, settings.SATDUMP_HTTP)


@router.get("")
def get_config() -> Config:
    return load_config(settings.CONFIG_FILE)


def keep_since(old: Config, config: Config) -> None:
    """A destination's `since` is the app's to set, not the page's (which may hold a copy from before "Send
    older passes"): one just switched to automatic starts with the passes finished from now on; the others
    keep what they had."""
    before = {d.name: d for d in old.destinations}
    now = time.time()
    for d in config.destinations:
        was = before.get(d.name)
        if d.mode == "auto" and (was is None or was.mode != "auto"):
            d.since = now
        else:
            d.since = was.since if was else 0


@router.put("")
def put_config(config: Config) -> Config:
    # FastAPI has already validated the body; an invalid one never gets here (422)
    old = load_config(settings.CONFIG_FILE)
    before = satdump_view(old)
    keep_since(old, config)
    save_config(settings.CONFIG_FILE, config)
    hub.publish("config", config.model_dump())          # other open tabs see the new settings
    # only settings SatDump sees are worth a restart (not Discord, display, ...)
    if satdump_view(config) != before:
        supervisor.request_restart("settings changed")
    return config


@router.get("/defaults")
def get_defaults() -> Config:
    return Config()
