import math
from datetime import datetime, timezone

import cbor2
from skyfield.api import EarthSatellite, load

from app import georef, passes
from app.config import Config
from app.orbits import parse_tles, predict

# Celestrak, 2026-10-15 (as in test_orbits.py)
TLE = """METEOR-M2 3
1 57166U 23091A   26288.31689027 -.00000012  00000+0  13653-4 0  9997
2 57166  98.5945 340.7511 0004154 165.6221 194.5077 14.24054260171612
"""
EPOCH = datetime(2026, 10, 15, 7, 36, tzinfo=timezone.utc).timestamp()


def station_config() -> Config:
    config = Config()
    config.station.lat, config.station.lon, config.station.alt = -34.6, -58.4, 25
    config.satellites[1].enabled = False        # no TLE for M2-4 here
    return config

# projection_cfg as SatDump 1.2.2 writes it for Meteor MSU-MR
CFG = {
    "type": "normal_single_line", "image_width": 1568, "scan_angle": 110.1,
    "roll_offset": -0.31, "pitch_offset": -3.1, "yaw_offset": 0.75, "timestamp_offset": -0.3,
    "interpolate_timestamps": 8, "interpolate_timestamps_scantime": 0.2,
    "timefilter": {"type": "simple", "scan_time": 1.6, "max_diff": 10},
}


def km_between(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def test_timestamp_filter_and_lines():
    cfg = {"timefilter": {"type": "simple", "scan_time": 1.6, "max_diff": 10},
           "interpolate_timestamps": 2, "interpolate_timestamps_scantime": 0.5}
    # like SatDump, the first stamp goes: nothing came before it to compare with
    assert georef.filter_timestamps([10, 11.2, 12.4, -1, 13.6], cfg) == [-1, 11.2, 12.4, -1, 13.6]
    assert georef.line_times([-1, 11.2], cfg) == [-1, -1, 10.7, 11.2]


def test_grid_lies_under_the_orbit(tmp_path):
    lines = TLE.strip().splitlines()
    first = predict(station_config(), parse_tles(TLE), EPOCH, hours=24)[0]
    start = (first["aos"] + first["los"]) / 2 - 12                  # around the top of the pass
    blocks = [start + i * 1.23 for i in range(21)]                   # the first one is filtered out
    product = tmp_path / "product.cbor"
    product.write_bytes(cbor2.dumps({
        "images": [{"file": "MSU-MR-1.png", "timestamps": blocks}],
        "projection_cfg": CFG, "tle": {"line1": lines[1], "line2": lines[2], "name": lines[0], "norad": 57166},
    }))

    grid = georef.georeference(product, 1568, len(blocks) * 8, rows=8, cols=5)
    assert grid["cols"] == [0, 392, 784, 1175, 1567]
    width = len(grid["cols"])
    rows = [grid["points"][i * width:(i + 1) * width] for i in range(len(grid["rows"]))]
    assert rows[0] == [None] * width                                  # the filtered first block
    middle_row = len(rows) // 2
    centre = rows[middle_row][width // 2]

    # the middle of the scan is near the point under the satellite at that line's time
    y = grid["rows"][middle_row]
    when = georef.line_times(georef.filter_timestamps(blocks, CFG), CFG)[y] + CFG["timestamp_offset"]
    ts = load.timescale(builtin=True)
    sub = EarthSatellite(lines[1], lines[2], lines[0], ts).at(ts.utc(1970, 1, 1, 0, 0, when)).subpoint()
    assert km_between(centre, (sub.latitude.degrees, sub.longitude.degrees)) < 80     # pitch offset: ~45 km

    # and the scan is about as wide as MSU-MR's 2800 km swath
    assert 2500 < km_between(rows[middle_row][0], rows[middle_row][-1]) < 3100


def test_grid_needs_a_matching_image(tmp_path):
    lines = TLE.strip().splitlines()
    product = tmp_path / "product.cbor"
    product.write_bytes(cbor2.dumps({"images": [{"timestamps": [EPOCH, EPOCH + 1.23]}], "projection_cfg": CFG,
                                     "tle": {"line1": lines[1], "line2": lines[2]}}))
    assert georef.georeference(product, 2800, 16) is None            # a corrected image: other geometry
    assert georef.georeference(product, 1568, 99) is None            # cropped composite: lines don't match


def test_drape_image_is_the_raw_main_composite():
    images = [passes.describe_image(p) | {"width": 10, "height": 10} for p in (
        "MSU-MR/msu_mr_rgb_MCIR.png", "MSU-MR/msu_mr_rgb_MCIR_corrected.png", "MSU-MR/msu_mr_rgb_MSA.png")]
    meta = {"main": "MSU-MR/msu_mr_rgb_MCIR_corrected.png", "images": images}
    assert passes.drape_image(meta)["path"] == "MSU-MR/msu_mr_rgb_MCIR.png"
    assert passes.drape_image({"main": None, "images": images}) is None
