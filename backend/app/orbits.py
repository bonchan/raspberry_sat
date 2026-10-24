"""Upcoming passes, computed here from the TLEs SatDump downloads.

SatDump only exposes its schedule as a small picture, so we predict the passes ourselves with
Skyfield: same orbits, same station, same minimum elevations.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from skyfield.api import EarthSatellite, load, wgs84

from app.config import Config

TRACK_STEP = 10             # seconds between points of a pass's sky track
LOOKBACK = timedelta(minutes=30)   # so a pass already under way is still found

_ts = None
_tle_cache: tuple[float, dict[int, tuple[str, str, str]]] | None = None


def timescale():
    global _ts
    if _ts is None:
        _ts = load.timescale(builtin=True)      # no download needed
    return _ts


def parse_tles(text: str) -> dict[int, tuple[str, str, str]]:
    """{norad: (name, line1, line2)} from a 3-line TLE file (2-line entries get the number as name)."""
    lines = [l.rstrip() for l in text.splitlines() if l.strip()]
    out = {}
    for i in range(len(lines) - 1):
        l1, l2 = lines[i], lines[i + 1]
        if l1.startswith("1 ") and l2.startswith("2 "):
            try:
                norad = int(l1[2:7])
            except ValueError:
                continue
            name = lines[i - 1].strip() if i > 0 and not lines[i - 1][:2] in ("1 ", "2 ") else str(norad)
            out[norad] = (name, l1, l2)
    return out


def load_tles(path: Path) -> dict[int, tuple[str, str, str]]:
    """SatDump's TLE file, re-read only when SatDump has updated it."""
    global _tle_cache
    mtime = path.stat().st_mtime
    if _tle_cache is None or _tle_cache[0] != mtime:
        _tle_cache = (mtime, parse_tles(path.read_text(encoding="utf-8", errors="replace")))
    return _tle_cache[1]


def unix(t) -> float:
    return t.utc_datetime().timestamp()


def satellite_up(config: Config, tles: dict[int, tuple[str, str, str]], when: float) -> str | None:
    """Which of the configured satellites was highest over the station shortly after `when` (a pass's
    start), if any was above the horizon: names passes SatDump could not identify."""
    ts = timescale()
    station = wgs84.latlon(config.station.lat, config.station.lon, elevation_m=config.station.alt)
    times = ts.from_datetimes([datetime.fromtimestamp(when + dt, timezone.utc) for dt in (60, 180, 300, 420)])
    best, best_el = None, 0.0
    for s in config.satellites:
        if s.norad not in tles:
            continue
        name, l1, l2 = tles[s.norad]
        alt, _, _ = (EarthSatellite(l1, l2, name, ts) - station).at(times).altaz()
        el = float(np.max(alt.degrees))
        if el > best_el:
            best, best_el = s.name or name, el
    return best


def simple_name(name: str) -> str:
    """"METEOR-M2 4", "Meteor-M2-4" and "meteor m2 4" all become "meteorm24"."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def pass_geometry(config: Config, tles: dict[int, tuple[str, str, str]], when: float, satellite: str = "") -> dict | None:
    """The orbit of a received pass: AOS, LOS, highest elevation and sky track of the configured satellite
    that was over the station at `when` (a time during the recording), the named one first. Uses the
    current TLEs, which are close enough for passes a few weeks back."""
    ts = timescale()
    station = wgs84.latlon(config.station.lat, config.station.lon, elevation_m=config.station.alt)
    t0 = ts.from_datetime(datetime.fromtimestamp(when, timezone.utc) - LOOKBACK)
    t1 = ts.from_datetime(datetime.fromtimestamp(when, timezone.utc) + LOOKBACK)
    wanted = simple_name(satellite)
    found = []                  # (named, max_el, pass)
    for s in config.satellites:
        if s.norad not in tles:
            continue
        name, l1, l2 = tles[s.norad]
        sat = EarthSatellite(l1, l2, name, ts)
        times, events = sat.find_events(station, t0, t1, altitude_degrees=0.0)
        rise = None
        for t, event in zip(times, events):
            if event == 0:
                rise = t
            elif event == 2 and rise is not None:
                if unix(rise) - 120 <= when <= unix(t):
                    p = describe_pass(sat, station, rise, t)
                    p["norad"] = s.norad
                    named = wanted != "" and wanted in (simple_name(s.name), simple_name(name))
                    found.append((named, p["max_el"], p))
                rise = None
    return max(found, key=lambda f: (f[0], f[1]))[2] if found else None


def predict(config: Config, tles: dict[int, tuple[str, str, str]], now: float, hours: float = 24) -> list[dict]:
    """Passes of the enabled satellites that end after `now` and start within `hours`."""
    ts = timescale()
    station = wgs84.latlon(config.station.lat, config.station.lon, elevation_m=config.station.alt)
    start = datetime.fromtimestamp(now, timezone.utc)
    t0, t1 = ts.from_datetime(start - LOOKBACK), ts.from_datetime(start + timedelta(hours=hours))

    passes = []
    for s in config.satellites:
        if not s.enabled or s.norad not in tles:
            continue
        name, l1, l2 = tles[s.norad]
        sat = EarthSatellite(l1, l2, name, ts)
        threshold = max(s.min_elevation, config.tracking.min_elevation)
        times, events = sat.find_events(station, t0, t1, altitude_degrees=0.0)
        rise = None
        for t, event in zip(times, events):
            if event == 0:
                rise = t
            elif event == 2 and rise is not None:
                p = describe_pass(sat, station, rise, t)
                if p["los"] > now:
                    p.update(name=s.name or name, norad=s.norad, scheduled=p["max_el"] >= threshold)
                    passes.append(p)
                rise = None
    passes.sort(key=lambda p: p["aos"])
    return passes


def describe_pass(sat: EarthSatellite, station, rise, set_) -> dict:
    ts = timescale()
    # from the whole second: worked out again a few minutes later (from another start time), the same pass
    # comes out exactly the same, and the topic "schedule" is only sent when the passes change
    rise = ts.from_datetime(datetime.fromtimestamp(round(unix(rise)), timezone.utc))
    set_ = ts.from_datetime(datetime.fromtimestamp(round(unix(set_)), timezone.utc))
    n = max(2, int((set_.tt - rise.tt) * 86400 / TRACK_STEP) + 1)
    times = ts.tt_jd(np.linspace(rise.tt, set_.tt, n))
    alt, az, _ = (sat - station).at(times).altaz()
    el, azd = alt.degrees, az.degrees
    top = int(np.argmax(el))
    return {
        "aos": unix(rise),
        "los": unix(set_),
        "tca": unix(times[top]),
        "max_el": round(float(el[top]), 1),
        "aos_az": round(float(azd[0]), 1),
        "los_az": round(float(azd[-1]), 1),
        "track": [[round(float(a), 1), round(float(e), 1)] for a, e in zip(azd, el)],
    }


class Schedule:
    """Predictions cached for a few minutes; recomputed when the settings or the TLEs change."""

    TTL = 300

    def __init__(self) -> None:
        self._key: tuple | None = None
        self._at = 0.0
        self._result: dict = {}

    def get(self, config: Config, tle_path: Path) -> dict:
        now = time.time()
        try:
            tle_mtime = tle_path.stat().st_mtime
        except OSError:
            return {"passes": [], "computed_at": now,
                    "error": "SatDump has not downloaded orbit data (TLEs) yet; it does when it starts."}
        key = (config.model_dump_json(), tle_mtime)
        if key != self._key or now - self._at > self.TTL:
            tles = load_tles(tle_path)
            missing = [s.name or str(s.norad) for s in config.satellites if s.enabled and s.norad not in tles]
            passes = predict(config, tles, now, hours=config.display.upcoming_days * 24)
            self._result = {"passes": passes, "computed_at": now, "days": config.display.upcoming_days,
                            "tle_updated_at": tle_mtime, "missing": missing}
            self._key, self._at = key, now
        else:
            # drop passes that have ended since
            self._result["passes"] = [p for p in self._result["passes"] if p["los"] > now]
        return self._result


schedule = Schedule()
