from fastapi.testclient import TestClient

from app.main import app
from app.routers import system


class Done:
    def __init__(self, returncode, stderr=""):
        self.returncode, self.stderr, self.stdout = returncode, stderr, ""


def test_power_actions_need_passwordless_sudo(monkeypatch):
    started = []
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Done(1, "sudo: a password is required"))
    monkeypatch.setattr(system.subprocess, "Popen", lambda *a, **k: started.append(a))
    r = TestClient(app).post("/api/system/reboot")
    assert r.status_code == 409 and "password" in r.json()["detail"]
    assert started == []


def test_power_action_is_started(monkeypatch):
    started = []
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Done(0))
    monkeypatch.setattr(system.subprocess, "Popen", lambda args, **k: started.append(args))
    assert TestClient(app).post("/api/system/poweroff").status_code == 200
    assert "systemctl --no-block poweroff" in started[0][-1]


def test_unknown_action_rejected():
    assert TestClient(app).post("/api/system/format-disk").status_code == 422


def test_restart_app_targets_our_service():
    assert system.POWER_COMMANDS["restart-app"].endswith("restart raspberry_sat")


MEMINFO = """MemTotal:        7999784 kB
MemFree:         5938412 kB
MemAvailable:    7012340 kB
Buffers:           66432 kB
Cached:          1009536 kB
HugePages_Total:       0
"""


def test_temperature_from_millidegrees(tmp_path, monkeypatch):
    (tmp_path / "temp").write_text("52582\n")
    monkeypatch.setattr(system, "THERMAL", tmp_path / "temp")
    assert system.temperature() == 52.582


def test_memory_used_leaves_out_the_cache(tmp_path, monkeypatch):
    (tmp_path / "meminfo").write_text(MEMINFO)
    monkeypatch.setattr(system, "MEMINFO", tmp_path / "meminfo")
    assert system.memory() == {"total": 7999784 * 1024, "used": (7999784 - 7012340) * 1024}


def test_no_sensors_off_the_pi(tmp_path, monkeypatch):
    monkeypatch.setattr(system, "THERMAL", tmp_path / "missing")
    monkeypatch.setattr(system, "MEMINFO", tmp_path / "missing")
    monkeypatch.setattr(system.settings, "DATA_DIR", tmp_path / "data")
    body = TestClient(app).get("/api/system").json()
    assert body["temperature"] is None and body["memory"] is None
    assert body["disk"]["total"] > 0
