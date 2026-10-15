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
