from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Config, Rotator
from app.satdump_cfg import NO_ROTATOR, build_autotrack_config

PASSES = Path("/data/passes")


def build(config: Config) -> dict:
    return build_autotrack_config(config, PASSES, "127.0.0.1:8081")


def test_only_enabled_satellites_are_tracked():
    config = Config()
    config.satellites[1].enabled = False
    objects = build(config)["tracked_objects"]
    assert [o["norad"] for o in objects] == [57166]
    assert objects[0]["min_elevation"] == 15
    assert objects[0]["downlinks"] == [{
        "frequency": 137_900_000,
        "live": True,
        "record": False,
        "pipeline_name": "meteor_m2-x_lrpt",
        "baseband_format": "cs8",
    }]


def test_station_receiver_and_output():
    config = Config()
    config.station.lat, config.station.lon, config.station.alt = -34.6, -58.4, 25
    cfg = build(config)
    assert cfg["qth"] == {"lat": -34.6, "lon": -58.4, "alt": 25}
    assert cfg["output_folder"] == str(PASSES)
    assert cfg["http_server"] == "127.0.0.1:8081"
    assert cfg["finish_processing"] is True
    params = cfg["parameters"]
    assert params["source"] == "rtlsdr"
    assert params["samplerate"] == 1_024_000
    assert params["initial_frequency"] == 137_900_000
    assert "source_id" not in params
    # SatDump reads these with get<int>()
    assert all(isinstance(params[k], int) for k in ("fft_size", "fft_rate", "fft_min", "fft_max"))


def test_device_id_passed_when_set():
    config = Config()
    config.sdr.source_id = "00000001"
    assert build(config)["parameters"]["source_id"] == "00000001"


def test_no_satellites_still_starts():
    config = Config(satellites=[])
    cfg = build(config)
    assert cfg["tracked_objects"] == []
    assert cfg["parameters"]["initial_frequency"] == 137_900_000


def test_rotator_off_points_nowhere():
    assert build(Config())["tracking"]["rotator_cfg"] == NO_ROTATOR


def test_rotator_on():
    config = Config(rotator=Rotator(enabled=True, address="192.168.1.77", port=4533))
    assert build(config)["tracking"]["rotator_cfg"] == {"address": "192.168.1.77", "port": 4533}


def test_short_rotator_address_rejected_only_when_used():
    with pytest.raises(ValidationError):
        Rotator(enabled=True, address="10.0.0.5")
    Rotator(enabled=False, address="10.0.0.5")


def test_keep_baseband_records():
    config = Config()
    config.storage.keep_baseband = True
    assert all(o["downlinks"][0]["record"] for o in build(config)["tracked_objects"])
