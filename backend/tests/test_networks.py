import pytest
from fastapi.testclient import TestClient

from app import networks
from app.main import app

UUID_HOME = "11111111-1111-1111-1111-111111111111"
UUID_PHONE = "22222222-2222-2222-2222-222222222222"


class FakeNmcli:
    """Answers the nmcli calls networks.py makes, and records the ones that change something."""

    def __init__(self):
        self.changes = []

    def __call__(self, *args, sudo=False, timeout=30):
        if args[-2:] == ("device", "status"):
            return "wlan0:wifi:connected:preconfigured\neth0:ethernet:unavailable:\nlo:loopback:unmanaged:\n"
        if args[-2:] == ("connection", "show"):
            return (f"preconfigured:{UUID_HOME}:802-11-wireless:yes:0:yes\n"
                    f"Pixel hotspot:{UUID_PHONE}:802-11-wireless:yes:10:no\n"
                    "lo:33333333-3333-3333-3333-333333333333:loopback:no:0:yes\n")
        if "802-11-wireless.ssid" in args:
            return {UUID_HOME: "Casa\\:5G\n", UUID_PHONE: "Pixel hotspot\n"}[args[-1]]
        if "list" in args:
            return ("*:Casa\\:5G:80:WPA2\n:Casa\\:5G:40:WPA2\n:Vecino:55:WPA2 WPA3\n:Cafe:30:\n::20:WPA2\n")
        self.changes.append((args, sudo))
        return ""


@pytest.fixture
def fake(monkeypatch):
    f = FakeNmcli()
    monkeypatch.setattr(networks, "nmcli", f)
    return f


def test_split_terse_unescapes():
    assert networks.split_terse("a\\:b:c\\\\d:") == ["a:b", "c\\d", ""]


def test_overview(fake):
    o = networks.overview()
    assert o["devices"][0] == {"device": "wlan0", "type": "wifi", "connected": True,
                               "state": "connected", "connection": "preconfigured"}
    assert [(n["ssid"], n["priority"], n["active"]) for n in o["saved"]] == [
        ("Pixel hotspot", 10, False), ("Casa:5G", 0, True)]


def test_scan_one_entry_per_name(fake):
    found = networks.scan()
    assert [n["ssid"] for n in found] == ["Casa:5G", "Vecino", "Cafe"]      # strongest first, hidden skipped
    assert found[0]["signal"] == 80 and found[0]["in_use"]
    assert found[2]["security"] == ""


def test_add_new_network(fake):
    assert networks.save_network("Obra", "secret123", 5, False, "") == "added"
    args, sudo = fake.changes[0]
    assert sudo and args[:2] == ("connection", "add")
    assert ("ifname", "wlan0") == args[args.index("ifname"):args.index("ifname") + 2]
    assert "wpa-psk" in args and "secret123" in args and "5" in args


def test_saving_a_known_name_updates_it(fake):
    assert networks.save_network("Pixel hotspot", "", 20, False, "") == "updated"
    args, _ = fake.changes[0]
    assert args[:3] == ("connection", "modify", UUID_PHONE)
    assert "wifi-sec.psk" not in args                    # empty password keeps the saved one


def test_bad_passwords_rejected(fake):
    with pytest.raises(networks.NetworkError):
        networks.save_network("Obra", "short", 0, False, "")
    assert fake.changes == []


def test_cannot_forget_the_network_in_use(fake):
    with pytest.raises(networks.NetworkError, match="right now"):
        networks.forget(UUID_HOME)
    networks.forget(UUID_PHONE)
    assert fake.changes == [(("connection", "delete", UUID_PHONE), True)]


def test_api(fake):
    client = TestClient(app)
    assert client.get("/api/networks").json()["error"] is None
    assert client.post("/api/networks", json={"ssid": "Obra", "password": "secret123"}).json() == {"result": "added"}
    assert client.delete(f"/api/networks/{UUID_HOME}").status_code == 409
    assert client.patch(f"/api/networks/{UUID_PHONE}", json={"priority": 5000}).status_code == 422
