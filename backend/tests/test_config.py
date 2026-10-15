import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import settings
from app.config import Config, Station, load_config, save_config
from app.main import app


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    monkeypatch.setattr(settings, "CONFIG_FILE", path)
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    return path


def test_missing_file_gives_defaults(config_file):
    config = load_config(config_file)
    assert config == Config()
    assert [s.norad for s in config.satellites] == [57166, 59051]


def test_save_and_load_round_trip(config_file):
    config = Config()
    config.station.lat = -34.6
    config.discord.webhook_url = "https://example.invalid/hook"
    save_config(config_file, config)
    assert load_config(config_file) == config


def test_invalid_file_is_moved_aside(config_file):
    config_file.write_text(json.dumps({"stations": [{"lat": 500}]}))
    assert load_config(config_file) == Config()
    assert not config_file.exists()
    assert len(list(config_file.parent.glob("config.json.bad-*"))) == 1


def test_old_single_station_config_still_loads(config_file):
    config_file.write_text(json.dumps({"station": {"name": "roof", "lat": -34.6, "lon": -58.4, "alt": 25}}))
    config = load_config(config_file)
    assert [s.name for s in config.stations] == ["roof"]
    assert config.active_station == 0
    assert config.station.lat == -34.6


def test_selected_station_is_the_one_used():
    config = Config(stations=[Station(name="home"), Station(name="field", lat=-40.0)], active_station=1)
    assert config.station.name == "field"
    with pytest.raises(ValidationError):
        Config(stations=[Station()], active_station=1)
    with pytest.raises(ValidationError):
        Config(stations=[])


def test_api_get_put(config_file):
    client = TestClient(app)
    body = client.get("/api/config").json()
    body["stations"] = [{"name": "roof", "lat": -34.6, "lon": -58.4, "alt": 25},
                        {"name": "field", "lat": -40.0, "lon": -65.0, "alt": 300}]
    body["active_station"] = 1
    assert client.put("/api/config", json=body).status_code == 200
    saved = client.get("/api/config").json()
    assert [s["name"] for s in saved["stations"]] == ["roof", "field"]
    assert saved["active_station"] == 1
    assert json.loads(config_file.read_text())["active_station"] == 1


def test_api_rejects_invalid(config_file):
    client = TestClient(app)
    body = client.get("/api/config").json()
    body["stations"][0]["lat"] = 500
    assert client.put("/api/config", json=body).status_code == 422
    body = client.get("/api/config").json()
    body["active_station"] = 5
    assert client.put("/api/config", json=body).status_code == 422
    assert not config_file.exists()


def test_api_save_asks_for_a_satdump_restart(config_file, monkeypatch):
    from app.supervisor import supervisor
    monkeypatch.setattr(supervisor, "restart_pending", False)
    client = TestClient(app)
    client.put("/api/config", json=client.get("/api/config").json())
    assert supervisor.restart_pending


def test_api_paths_are_not_swallowed_by_the_frontend(config_file):
    assert TestClient(app).get("/api/nope").status_code == 404
