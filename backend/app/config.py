"""Station configuration: one JSON file, edited from the web UI."""

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

log = logging.getLogger(__name__)


def station_id(name: str, lat: float, lon: float, alt: float) -> str:
    """The id of a station that has none yet: from what it is when it gets one, so a station from before ids,
    and the passes it received (pass.json keeps a copy of the station), get the same id."""
    return hashlib.sha1(json.dumps([name, float(lat), float(lon), float(alt)]).encode()).hexdigest()[:10]


class Station(BaseModel):
    """A place the Pi receives from. Each pass's pass.json keeps a copy as it was then, id included, so
    editing a station later changes no pass; the hub groups passes by the id."""
    id: str = ""                           # permanent once saved; made from the station when it has none
    name: str = "home"
    lat: float = Field(0.0, ge=-90, le=90)
    lon: float = Field(0.0, ge=-180, le=180)
    alt: float = 0.0                       # meters above sea level

    @model_validator(mode="after")
    def give_id(self):
        if not self.id.strip():
            self.id = station_id(self.name, self.lat, self.lon, self.alt)
        return self


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
    # auto: each pass is posted once its images are made; manual: a button on the pass page posts it.
    # Configs from before this choice had "enabled" and "webhook_url", never used: they load as "off".
    mode: Literal["off", "auto", "manual"] = "off"
    application_id: str = ""               # developer portal → General Information; only builds the invite link
    bot_token: str = ""                    # developer portal → Bot → Reset Token
    channel_id: str = ""                   # Discord, Developer Mode on: right-click the channel → Copy Channel ID
    composites: list[str] = []             # what to post, in order: "MCIR", "MCIR corrected", ...; empty = one per composite
    post_failed: bool = False              # also post passes that produced no images

    @field_validator("bot_token")
    @classmethod
    def bare_token(cls, v: str) -> str:
        v = v.strip()
        return v[4:].strip() if v.lower().startswith("bot ") else v

    @field_validator("application_id", "channel_id")
    @classmethod
    def discord_id(cls, v: str) -> str:
        # a copied link works too: https://discord.com/channels/<server>/<channel> gives the channel
        v = v.strip().rstrip("/").rsplit("/", 1)[-1]
        if v and not v.isdigit():
            raise ValueError("must be a number, as Discord's Copy ID gives it")
        return v

    @model_validator(mode="after")
    def can_post_when_on(self):
        if self.mode != "off" and not (self.bot_token and self.channel_id):
            raise ValueError("posting to Discord needs the bot token and the channel ID")
        return self


class Destination(BaseModel):
    """A website that collects passes from several stations, such as the raspberry-sat hub (hub/): its
    Stations page gives the URL and this station's token. Sending: destinations.py."""
    name: str = "hub"                      # shown on the pass page; also the key of its notes in pass.json
    url: str = ""                          # https://raspberry-sat-hub.<subdomain>.workers.dev/ingest
    token: str = ""
    mode: Literal["off", "auto", "manual"] = "off"   # auto: each finished pass; manual: a button on the pass page
    images: list[str] = []                 # what to send, as Discord's composites; empty = one per composite
    full_size: bool = False                # the large JPEG at full size instead of 1600 px wide
    delete_after_upload: bool = False      # once sent, keep only the main image (and pass data) on the Pi
    # automatic sending starts with passes finished after this; set when it is switched on (routers/config.py),
    # 0 after "Send older passes"
    since: float = 0

    @field_validator("name")
    @classmethod
    def plain_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 40:
            raise ValueError("give the destination a name, up to 40 characters")
        return v

    @field_validator("url")
    @classmethod
    def http_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if v and not v.startswith(("https://", "http://")):
            raise ValueError("the URL starts with https://")
        return v

    @field_validator("token")
    @classmethod
    def bare_token(cls, v: str) -> str:
        v = v.strip()
        return v[7:].strip() if v.lower().startswith("bearer ") else v

    @model_validator(mode="after")
    def can_send_when_on(self):
        if self.mode != "off" and not (self.url and self.token):
            raise ValueError(f"sending to {self.name} needs its URL and token")
        return self


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
    destinations: list[Destination] = []
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

    @model_validator(mode="after")
    def station_ids_differ(self):
        # a new station made from what an earlier one was (same name and place) would get its id: keep apart
        seen: set[str] = set()
        for s in self.stations:
            base, n = s.id, 2
            while s.id in seen:
                s.id, n = f"{base}-{n}", n + 1
            seen.add(s.id)
        return self

    @model_validator(mode="after")
    def destination_names_differ(self):
        names = [d.name.casefold() for d in self.destinations]
        if len(names) != len(set(names)):
            raise ValueError("two destinations have the same name")
        return self

    def destination(self, name: str) -> Destination | None:
        return next((d for d in self.destinations if d.name == name), None)

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
        data = json.loads(path.read_text(encoding="utf-8"))
        config = Config.model_validate(data)
    except (ValueError, ValidationError) as e:   # json.JSONDecodeError is a ValueError
        bad = path.with_name(f"{path.name}.bad-{int(time.time())}")
        path.replace(bad)
        log.error("config %s is invalid, moved to %s: %s", path, bad, e)
        return Config()
    if not stations_have_ids(data):
        # stations from before ids just got theirs: save them, so they stay whatever is edited later
        try:
            save_config(path, config)
        except OSError:
            log.exception("could not save the stations' new ids to %s", path)
    return config


def stations_have_ids(data) -> bool:
    if not isinstance(data, dict):
        return True
    raw = data.get("stations", [data["station"]] if "station" in data else None)
    return isinstance(raw, list) and all(isinstance(s, dict) and s.get("id") for s in raw)


def save_config(path: Path, config: Config) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(config.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(path)                      # a power cut mid-write leaves the old file intact
