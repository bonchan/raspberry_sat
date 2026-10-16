import time

import pytest

from app import tasks


@pytest.fixture
def station(monkeypatch):
    """Nothing received or decoding, SatDump wanted, and a schedule the test fills in."""
    upcoming = []
    monkeypatch.setattr(tasks.tracker, "receiving", lambda: False)
    monkeypatch.setattr(tasks.passes, "output_busy", lambda path: False)
    monkeypatch.setattr(tasks.supervisor, "wanted", True)
    monkeypatch.setattr(tasks, "load_config", lambda path: None)
    monkeypatch.setattr(tasks.orbits.schedule, "get", lambda config, tles: {"passes": upcoming})
    return upcoming


def a_pass(starts_in: float, scheduled: bool = True) -> dict:
    aos = time.time() + starts_in
    return {"name": "METEOR-M2 4", "aos": aos, "los": aos + 900, "scheduled": scheduled}


def test_free_when_the_next_pass_is_far(station):
    station.append(a_pass(3600))
    assert tasks.update_blocker() is None


def test_blocked_shortly_before_a_recorded_pass(station):
    station.append(a_pass(120))
    blocked = tasks.update_blocker()
    assert blocked["reason"] == "pass_soon" and blocked["satellite"] == "METEOR-M2 4"


def test_low_passes_do_not_block(station):
    station.append(a_pass(120, scheduled=False))
    assert tasks.update_blocker() is None


def test_no_pass_blocks_while_satdump_is_stopped(station, monkeypatch):
    station.append(a_pass(120))
    monkeypatch.setattr(tasks.supervisor, "wanted", False)
    assert tasks.update_blocker() is None


def test_blocked_while_receiving_or_decoding(station, monkeypatch):
    monkeypatch.setattr(tasks.passes, "output_busy", lambda path: True)
    assert tasks.update_blocker()["reason"] == "decoding"
    monkeypatch.setattr(tasks.tracker, "receiving", lambda: True)
    assert tasks.update_blocker()["reason"] == "receiving"
