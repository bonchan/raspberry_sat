from datetime import datetime, timezone

from app.config import Config
from app.orbits import parse_tles, predict
from app.tasks import Tracker

# Celestrak, 2026-10-15
TLE = """METEOR-M2 3
1 57166U 23091A   26288.31689027 -.00000012  00000+0  13653-4 0  9997
2 57166  98.5945 340.7511 0004154 165.6221 194.5077 14.24054260171612
"""
EPOCH = datetime(2026, 10, 15, 7, 36, tzinfo=timezone.utc).timestamp()


def station_config() -> Config:
    config = Config()
    config.station.lat, config.station.lon, config.station.alt = -34.6, -58.4, 25
    config.satellites[1].enabled = False        # no TLE for M2-4 in this test
    return config


def test_parse_tles():
    tles = parse_tles(TLE + "1 99999U 23091A   26288.31689027 -.00000012  00000+0  13653-4 0  9997\n"
                            "2 99999  98.5945 340.7511 0004154 165.6221 194.5077 14.24054260171612\n")
    assert tles[57166][0] == "METEOR-M2 3"
    assert tles[99999][0] == "99999"            # 2-line entry: no name line before it


def test_predict_meteor_passes_over_buenos_aires():
    config = station_config()
    passes = predict(config, parse_tles(TLE), EPOCH, hours=24)
    assert len(passes) >= 3                      # a polar orbiter passes a few times a day
    for p in passes:
        assert p["norad"] == 57166
        assert p["aos"] < p["tca"] < p["los"]
        assert 3 * 60 < p["los"] - p["aos"] < 20 * 60
        assert 0 < p["max_el"] <= 90
        assert p["scheduled"] == (p["max_el"] >= 15)
        assert all(0 <= az < 360 and -1 <= el <= 90 for az, el in p["track"])
    assert [p["aos"] for p in passes] == sorted(p["aos"] for p in passes)


def test_schedule_covers_the_configured_days(tmp_path):
    import time
    import pytest
    from pydantic import ValidationError
    from app.orbits import Schedule

    tle_file = tmp_path / "satdump_tles.txt"
    tle_file.write_text(TLE)
    config = station_config()
    config.display.upcoming_days = 3
    result = Schedule().get(config, tle_file)
    assert result["days"] == 3
    assert result["passes"] and all(p["aos"] < time.time() + 3 * 86400 for p in result["passes"])
    assert result["passes"][-1]["aos"] > time.time() + 2 * 86400     # really reaches the third day

    for days in (0, 15):
        with pytest.raises(ValidationError):
            Config.model_validate({"display": {"upcoming_days": days}})


def test_predict_skips_disabled_and_unknown_satellites():
    config = station_config()
    config.satellites[0].enabled = False
    assert predict(config, parse_tles(TLE), EPOCH) == []
    assert predict(station_config(), {}, EPOCH) == []


def test_tracker_records_signal_during_a_pass():
    import time
    tracker = Tracker()
    now = time.time()
    in_pass = {
        "object_tracker": {"next_event_is_aos": False, "next_los_time": now + 600,
                           "sat_current_pos": {"az": 120.0, "el": 35.0}},
        "live_pipeline": {"psk_demod": {"snr": 6.2, "peak_snr": 8.0, "freq": -120.0},
                          "ccsds_conv_concat_decoder": {"viterbi_ber": 0.05, "viterbi_lock": 1,
                                                        "deframer_lock": True, "rs_avg": 2}},
    }
    tracker.update(in_pass)
    tracker.update(in_pass)
    assert len(tracker.history) == 2
    assert tracker.history[0]["snr"] == 6.2 and tracker.history[0]["deframer_lock"] is True
    assert tracker.history[0]["el"] == 35.0

    after = {"object_tracker": {"next_event_is_aos": True, "next_los_time": now + 7000}}
    tracker.update(after)
    assert tracker.last_los > 0
    assert len(tracker.history) == 2             # kept until the next pass starts


def test_low_pass_is_overhead_but_not_received():
    import time
    tracker = Tracker()
    # SatDump's tracker follows the satellite, but no pipeline runs: the pass is under the minimum elevation
    tracker.update({"object_tracker": {"next_event_is_aos": False, "next_los_time": time.time() + 300,
                                       "sat_current_pos": {"az": 200.0, "el": 6.0}}})
    assert tracker.overhead() and not tracker.receiving()
    assert tracker.history == [] and tracker.last_los == 0
