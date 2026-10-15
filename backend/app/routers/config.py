from fastapi import APIRouter

from app import settings
from app.config import Config, load_config, save_config
from app.satdump_cfg import build_autotrack_config
from app.supervisor import supervisor

router = APIRouter(prefix="/config", tags=["config"])


def satdump_view(config: Config) -> dict:
    return build_autotrack_config(config, settings.PASSES_DIR, settings.SATDUMP_HTTP)


@router.get("")
def get_config() -> Config:
    return load_config(settings.CONFIG_FILE)


@router.put("")
def put_config(config: Config) -> Config:
    # FastAPI has already validated the body; an invalid one never gets here (422)
    before = satdump_view(load_config(settings.CONFIG_FILE))
    save_config(settings.CONFIG_FILE, config)
    # only settings SatDump sees are worth a restart (not Discord, display, ...)
    if satdump_view(config) != before:
        supervisor.request_restart("settings changed")
    return config


@router.get("/defaults")
def get_defaults() -> Config:
    return Config()
