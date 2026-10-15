import json

import pytest
from fastapi.testclient import TestClient

from app import settings
from app.config import Config, load_config, save_config
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
    config_file.write_text(json.dumps({"station": {"lat": 500}}))
    assert load_config(config_file) == Config()
    assert not config_file.exists()
    assert len(list(config_file.parent.glob("config.json.bad-*"))) == 1


def test_api_get_put(config_file):
    client = TestClient(app)
    body = client.get("/api/config").json()
    body["station"]["name"] = "roof"
    assert client.put("/api/config", json=body).status_code == 200
    assert client.get("/api/config").json()["station"]["name"] == "roof"
    assert json.loads(config_file.read_text())["station"]["name"] == "roof"


def test_api_rejects_invalid(config_file):
    client = TestClient(app)
    body = client.get("/api/config").json()
    body["station"]["lat"] = 500
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
