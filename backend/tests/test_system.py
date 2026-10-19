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


def test_uptime(tmp_path, monkeypatch):
    (tmp_path / "uptime").write_text("12345.67 45678.90\n")
    monkeypatch.setattr(system, "UPTIME", tmp_path / "uptime")
    assert system.uptime() == 12345.67


def test_cpu_usage_since_the_last_reading(tmp_path, monkeypatch):
    import time
    stat = tmp_path / "stat"
    monkeypatch.setattr(system, "STAT", stat)
    # user nice system idle iowait irq softirq steal: 300 of 1000 ticks busy since boot
    stat.write_text("cpu  200 0 100 650 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n")
    assert system.cpu_times() == (300, 1000)
    monkeypatch.setattr(system, "_cpu_last", (time.time() - 10, 300, 1000))
    # then 100 busy of 400 more ticks
    stat.write_text("cpu  260 0 140 920 80 0 0 0 0 0\n")
    assert system.cpu_usage() == 0.25


class Output:
    def __init__(self, stdout, returncode=0):
        self.stdout, self.returncode, self.stderr = stdout, returncode, ""


def test_throttling_now_and_since_boot(monkeypatch):
    # under-voltage and throttled now (bits 0, 2), and so since boot (16, 18)
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Output("throttled=0x50005\n"))
    assert system.throttling() == {"now": ["under_voltage", "throttled"], "since_boot": ["under_voltage", "throttled"]}


def test_throttling_only_since_boot(monkeypatch):
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Output("throttled=0x10000\n"))
    assert system.throttling() == {"now": [], "since_boot": ["under_voltage"]}


def test_clock_synced(monkeypatch):
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Output("yes\n"))
    assert system.clock_synced() is True
    monkeypatch.setattr(system.subprocess, "run", lambda *a, **k: Output("no\n"))
    assert system.clock_synced() is False


def test_network_wifi_signal(monkeypatch):
    monkeypatch.setattr(system.networks, "devices", lambda: [
        {"device": "wlan0", "type": "wifi", "connected": True},
        {"device": "eth0", "type": "ethernet", "connected": False}])
    monkeypatch.setattr(system.networks, "wifi_link", lambda: {"ssid": "Casa", "signal": 64})
    assert system.network() == {"ethernet": False, "wifi": {"ssid": "Casa", "signal": 64}}


def test_nothing_to_read_off_the_pi(tmp_path, monkeypatch):
    for name in ("THERMAL", "MEMINFO", "UPTIME", "STAT"):
        monkeypatch.setattr(system, name, tmp_path / "missing")

    def missing(*a, **k):
        raise FileNotFoundError(a[0][0])

    monkeypatch.setattr(system.subprocess, "run", missing)          # also what nmcli runs through
    monkeypatch.setattr(system.settings, "DATA_DIR", tmp_path / "data")
    body = TestClient(app).get("/api/system").json()
    for key in ("temperature", "memory", "uptime", "cpu", "throttling", "clock_synced", "network"):
        assert body[key] is None, key
    assert body["disk"]["total"] > 0
