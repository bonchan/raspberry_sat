from fastapi import APIRouter

from app import settings
from app.config import Config, load_config, save_config
from app.supervisor import supervisor

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config() -> Config:
    return load_config(settings.CONFIG_FILE)


@router.put("")
def put_config(config: Config) -> Config:
    # FastAPI has already validated the body; an invalid one never gets here (422)
    save_config(settings.CONFIG_FILE, config)
    supervisor.request_restart("settings changed")
    return config


@router.get("/defaults")
def get_defaults() -> Config:
    return Config()
