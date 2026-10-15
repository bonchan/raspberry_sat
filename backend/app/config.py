"""Station configuration: one JSON file, edited from the web UI."""

import json
import logging
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

log = logging.getLogger(__name__)


class Station(BaseModel):
    name: str = "home"
    lat: float = Field(0.0, ge=-90, le=90)
    lon: float = Field(0.0, ge=-180, le=180)
    alt: float = 0.0                       # meters above sea level


class Sdr(BaseModel):
    source: str = "rtlsdr"                 # SatDump source type
    source_id: str = ""                    # empty = first device of that type
    samplerate: int = Field(1_024_000, gt=0)
    # dB. Tuners only have fixed steps; SatDump's rtlsdr source rounds UP to the next one (35 -> 36.4).
    # R820T/R828D (incl. RTL-SDR Blog V4): 0.0 0.9 1.4 2.7 3.7 7.7 8.7 12.5 14.4 15.7 16.6 19.7 20.7 22.9
    # 25.4 28.0 29.7 32.8 33.8 36.4 37.2 38.6 40.2 42.1 43.4 43.9 44.5 48.0 49.6. Other tuners differ.
    # Later: ask the dongle for its steps (rtlsdr_get_tuner_gains, while SatDump has the SDR idle)
    # and offer them as a dropdown in Settings instead of a free number.
    gain: float = Field(38.6, ge=0)
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


class Display(BaseModel):
    show_low_passes: bool = True           # list passes that stay under the minimum elevation
    upcoming_days: int = Field(7, ge=1, le=14)    # how far ahead the upcoming passes list goes
    language: Literal["en", "es"] = "en"   # of the web interface


def default_satellites() -> list[Satellite]:
    return [
        Satellite(name="METEOR-M2 3", norad=57166, frequency_hz=137_900_000),
        Satellite(name="METEOR-M2 4", norad=59051, frequency_hz=137_900_000),
    ]


class Config(BaseModel):
    stations: list[Station] = Field(default_factory=lambda: [Station()], min_length=1)
    active_station: int = 0                # index into stations: the one SatDump uses
    sdr: Sdr = Field(default_factory=Sdr)
    satellites: list[Satellite] = Field(default_factory=default_satellites)
    tracking: Tracking = Field(default_factory=Tracking)
    rotator: Rotator = Field(default_factory=Rotator)
    discord: Discord = Field(default_factory=Discord)
    storage: Storage = Field(default_factory=Storage)
    display: Display = Field(default_factory=Display)

    @model_validator(mode="before")
    @classmethod
    def single_station_to_list(cls, data):
        # configs saved before multiple stations had one "station"
        if isinstance(data, dict) and "station" in data and "stations" not in data:
            data = {**data, "stations": [data["station"]], "active_station": 0}
            del data["station"]
        return data

    @model_validator(mode="after")
    def active_station_exists(self):
        if not 0 <= self.active_station < len(self.stations):
            raise ValueError("active_station must point at one of the stations")
        return self

    @property
    def station(self) -> Station:
        """The selected station."""
        return self.stations[self.active_station]


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
