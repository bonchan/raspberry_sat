"""Station configuration: one JSON file, edited from the web UI."""

import json
import logging
import time
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError, model_validator

log = logging.getLogger(__name__)


class Station(BaseModel):
    name: str = "raspberry_sat"
    lat: float = Field(0.0, ge=-90, le=90)
    lon: float = Field(0.0, ge=-180, le=180)
    alt: float = 0.0                       # meters above sea level


class Sdr(BaseModel):
    source: str = "rtlsdr"                 # SatDump source type
    source_id: str = ""                    # empty = first device of that type
    samplerate: int = Field(1_024_000, gt=0)
    gain: float = Field(30.0, ge=0)
    agc: bool = False
    bias: bool = False                     # bias-tee, for an LNA at the antenna
    ppm_correction: int = 0


class Satellite(BaseModel):
    name: str
    norad: int = Field(gt=0)
    frequency_hz: int = Field(gt=0)
    pipeline: str = "meteor_m2-x_lrpt"     # SatDump pipeline id
    min_elevation: float = Field(15.0, ge=0, le=90)
    enabled: bool = True


class Tracking(BaseModel):
    min_elevation: float = Field(10.0, ge=0, le=90)
    stop_sdr_when_idle: bool = True


class Rotator(BaseModel):
    enabled: bool = False
    address: str = "192.168.1.50"
    port: int = Field(4533, ge=1, le=65535)

    @model_validator(mode="after")
    def address_satdump_can_use(self):
        # SatDump 1.2.2 copies the address over its default "127.0.0.1" without a terminator,
        # so a shorter one keeps the leftover characters: "10.0.0.5" becomes "10.0.0.51"
        if self.enabled and len(self.address) < len("127.0.0.1"):
            raise ValueError("SatDump 1.2.2 garbles rotator addresses shorter than 9 characters")
        return self


class Discord(BaseModel):
    enabled: bool = False
    webhook_url: str = ""
    composites: list[str] = []             # image names to post; empty = a sensible default
    post_failed: bool = False              # also post passes that produced no images


class Storage(BaseModel):
    keep_days: int = Field(14, ge=1)
    max_gb: float = Field(40.0, gt=0)
    keep_baseband: bool = False


def default_satellites() -> list[Satellite]:
    return [
        Satellite(name="METEOR-M2 3", norad=57166, frequency_hz=137_900_000),
        Satellite(name="METEOR-M2 4", norad=59051, frequency_hz=137_900_000),
    ]


class Config(BaseModel):
    station: Station = Field(default_factory=Station)
    sdr: Sdr = Field(default_factory=Sdr)
    satellites: list[Satellite] = Field(default_factory=default_satellites)
    tracking: Tracking = Field(default_factory=Tracking)
    rotator: Rotator = Field(default_factory=Rotator)
    discord: Discord = Field(default_factory=Discord)
    storage: Storage = Field(default_factory=Storage)


def load_config(path: Path) -> Config:
    """The saved config, or the defaults when there is none yet.

    A file that no longer validates is moved aside (config.json.bad-<time>) rather than lost,
    and the defaults are used, so the web UI always comes up.
    """
    if not path.exists():
        return Config()
    try:
        return Config.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (ValueError, ValidationError) as e:   # json.JSONDecodeError is a ValueError
        bad = path.with_name(f"{path.name}.bad-{int(time.time())}")
        path.replace(bad)
        log.error("config %s is invalid, moved to %s: %s", path, bad, e)
        return Config()


def save_config(path: Path, config: Config) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(config.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(path)                      # a power cut mid-write leaves the old file intact
