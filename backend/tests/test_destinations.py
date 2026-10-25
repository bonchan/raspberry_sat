import asyncio
import json
import os
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import destinations, passes, settings
from app.config import Config, Destination, Station, load_config, save_config, station_id
from app.main import app

STARTED = 1791810618.85        # 2026-10-12 13:10:18 UTC
URL = "https://hub.example/ingest"


def make_png(path, color):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (300, 200), color).save(path)


def finished_pass(passes_dir, station=None):
    """A finished pass: MCIR corrected (main), MCIR raw, MSA corrected, and SatDump's frames file."""
    folder = passes_dir / "20261012 meteor m2-3 001"
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MCIR_corrected.png", (90, 120, 160))
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MCIR.png", (90, 120, 160))
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MSA_corrected.png", (200, 180, 150))
    (folder / "meteor_m2-x_lrpt.cadu").write_bytes(b"\0" * 1024)
    (folder / "dataset.json").write_text(json.dumps({"satellite": "METEOR-M2-3", "timestamp": STARTED}))
    old = time.time() - 3600
    for f in folder.rglob("*"):
        os.utime(f, (old, old))
    folder = passes.finalize(folder)
    if station is not None:
        meta = passes.read_json(folder / passes.META)
        meta["station"] = station
        passes.write_meta(folder, meta)
    return folder


class FakeHub:
    """Answers like the raspberry-sat hub (hub/src/ingest.ts) and keeps what it got."""

    def __init__(self, receiver="k7m2q9xd", fail=None):
        self.receiver, self.fail = receiver, fail
        self.requests: list[httpx.Request] = []
        self.files: dict[str, bytes] = {}
        self.commits: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(self.fail[0], json={"error": self.fail[1]})
        path = request.url.path
        if request.method == "GET" and path.endswith("/hello"):
            return httpx.Response(200, json={"receiver": {"id": self.receiver, "name": "Roof Pi"}, "protocol": 1})
        if request.method == "PUT":
            self.files[path] = request.read()
            return httpx.Response(200, json={"stored": path})
        if request.method == "POST":
            self.commits.append(json.loads(request.read()))
            return httpx.Response(200, json={"id": f"{self.receiver}~p", "url": "https://hub.example/passes/p",
                                             "receiver": self.receiver})
        return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def hub(monkeypatch):
    monkeypatch.setattr(destinations, "_down", {})
    monkeypatch.setattr(destinations, "_receivers", {})

    def install(**kwargs):
        fake = FakeHub(**kwargs)
        monkeypatch.setattr(destinations, "transport", httpx.MockTransport(fake))
        return fake
    return install


def dest(**kwargs) -> Destination:
    return Destination(**{"name": "hub", "url": URL, "token": "secret", "mode": "auto", **kwargs})


def note_of(folder, name="hub"):
    return destinations.notes(passes.read_json(folder / passes.META)).get(name) or {}


# ---------- sending ----------

def test_files_first_then_the_pass(tmp_path, hub):
    folder = finished_pass(tmp_path)
    fake = hub()
    config = Config(stations=[Station(name="L1", lat=-34.6, lon=-58.4, alt=25)], destinations=[dest()])
    note = asyncio.run(destinations.send_pass(folder, config, config.destinations[0]))

    assert fake.requests[0].headers["authorization"] == "Bearer secret"
    puts = sorted(p.split("/files/")[1] for p in fake.files)
    assert puts == ["large/MSU-MR/msu_mr_rgb_MCIR_corrected.png.jpg", "large/MSU-MR/msu_mr_rgb_MSA_corrected.png.jpg",
                    "thumb/MSU-MR/msu_mr_rgb_MCIR_corrected.png.jpg", "thumb/MSU-MR/msu_mr_rgb_MSA_corrected.png.jpg"]
    assert fake.requests[-1].method == "POST"                 # the pass last, once its files are there
    body = fake.commits[0]
    assert body["images"][0] == "MSU-MR/msu_mr_rgb_MCIR_corrected.png"      # the main image first
    assert body["pass"]["station"]["name"] == "L1"
    assert body["pass"]["station"]["id"] == config.stations[0].id
    assert "hubs" not in body["pass"] and "discord" not in body["pass"]
    assert note["receiver"] == "k7m2q9xd" and note["images"] == 2
    assert note_of(folder)["url"] == "https://hub.example/passes/p"


def test_a_new_receiver_gets_the_passes_again(tmp_path, hub):
    folder = finished_pass(tmp_path)
    hub(receiver="aaaa1111")
    config = Config(destinations=[dest()])
    d = config.destinations[0]
    asyncio.run(destinations.send_pass(folder, config, d))
    meta = passes.read_json(folder / passes.META)
    assert not destinations.due(meta, d, config, time.time())        # there, and unchanged

    # the Pi added to the hub again: a new token, another receiver
    destinations._receivers.clear()
    hub(receiver="bbbb2222")
    assert asyncio.run(destinations.learn_receivers(config, time.time())) == []
    assert destinations.receiver_of(d) == "bbbb2222"
    assert destinations.due(meta, d, config, time.time())
    assert destinations.queued(tmp_path, d) == 1


def test_a_note_from_before_receivers_counts_as_another(tmp_path, hub):
    folder = finished_pass(tmp_path)
    destinations.save_note(folder, "hub", {"uploaded_at": 1.0, "url": "x", "sent": "abc"})
    hub()
    config = Config(destinations=[dest()])
    asyncio.run(destinations.learn_receivers(config, time.time()))
    assert destinations.due(passes.read_json(folder / passes.META), config.destinations[0], config, time.time())


def test_failures_wait_longer_each_time(tmp_path, hub):
    folder = finished_pass(tmp_path)
    hub(fail=(503, "busy"))
    config = Config(destinations=[dest()])
    d = config.destinations[0]
    with pytest.raises(destinations.DestinationError) as e:
        asyncio.run(destinations.send_pass(folder, config, d))
    assert e.value.whole and "503" in str(e.value)
    first = note_of(folder)
    assert first["attempts"] == 1 and 55 < first["next_try"] - first["failed_at"] <= 60
    meta = passes.read_json(folder / passes.META)
    assert not destinations.due(meta, d, config, first["failed_at"] + 30)
    assert destinations.due(meta, d, config, first["failed_at"] + 61)
    with pytest.raises(destinations.DestinationError):
        asyncio.run(destinations.send_pass(folder, config, d))
    second = note_of(folder)
    assert second["attempts"] == 2 and second["next_try"] - second["failed_at"] == pytest.approx(120)


def test_a_refused_pass_is_not_the_whole_destination(tmp_path, hub):
    folder = finished_pass(tmp_path)
    hub(fail=(400, "pass.time must be a unix time"))
    config = Config(destinations=[dest()])
    with pytest.raises(destinations.DestinationError) as e:
        asyncio.run(destinations.send_pass(folder, config, config.destinations[0]))
    assert not e.value.whole


def test_only_passes_since_it_was_switched_on(tmp_path, hub):
    folder = finished_pass(tmp_path)
    config = Config(destinations=[dest(since=time.time() + 60)])
    assert not destinations.due(passes.read_json(folder / passes.META), config.destinations[0], config, time.time())
    assert destinations.next_upload(tmp_path, config, time.time()) is None


# ---------- stations ----------

def test_an_older_pass_gets_the_id_of_its_station(tmp_path, hub):
    l1 = Station(name="L1", lat=-34.6, lon=-58.4, alt=25)
    folder = finished_pass(tmp_path, station={"name": "L1", "lat": -34.6, "lon": -58.4, "alt": 25.0})   # no id
    fake = hub()
    config = Config(stations=[Station(name="L2", lat=-31.4, lon=-64.2), l1], destinations=[dest()])
    asyncio.run(destinations.send_pass(folder, config, config.destinations[0]))
    assert fake.commits[0]["pass"]["station"]["id"] == l1.id          # its own station, not the one selected
    assert passes.read_json(folder / passes.META)["station"]["id"] == l1.id


def test_stations_get_ids_once_and_keep_them(tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"stations": [{"name": "L1", "lat": -34.6, "lon": -58.4, "alt": 25}]}))
    config = load_config(path)
    sid = config.stations[0].id
    assert sid == station_id("L1", -34.6, -58.4, 25)
    assert json.loads(path.read_text())["stations"][0]["id"] == sid      # saved right away
    config.stations[0].name, config.stations[0].lat = "Roof", -34.7
    save_config(path, config)
    assert load_config(path).stations[0].id == sid                      # renamed and moved: same id


def test_two_stations_never_share_an_id():
    config = Config(stations=[Station(name="A"), Station(name="A")])
    assert config.stations[0].id != config.stations[1].id


# ---------- deleting after upload ----------

def test_delete_after_upload_keeps_the_main_image(tmp_path, hub):
    folder = finished_pass(tmp_path)
    hub()
    config = Config(destinations=[dest(delete_after_upload=True)])
    d = config.destinations[0]
    asyncio.run(destinations.send_pass(folder, config, d))
    asyncio.run(destinations.learn_receivers(config, time.time()))
    found = destinations.next_slim(tmp_path, config, time.time())
    assert found is not None and found[0] == folder
    freed = destinations.slim(folder, d, note_of(folder))
    assert freed > 0
    assert (folder / "MSU-MR" / "msu_mr_rgb_MCIR_corrected.png").is_file()
    assert not (folder / "MSU-MR" / "msu_mr_rgb_MSA_corrected.png").exists()
    assert not (folder / "meteor_m2-x_lrpt.cadu").exists()
    assert passes.thumb_path(folder, "MSU-MR/msu_mr_rgb_MSA_corrected.png").is_file()     # thumbnails stay
    meta = passes.read_json(folder / passes.META)
    assert meta["slimmed"]["destination"] == "hub" and meta["slimmed"]["url"] == "https://hub.example/passes/p"
    assert not destinations.due(meta, d, config, time.time())            # slimming doesn't make it go again
    assert destinations.next_slim(tmp_path, config, time.time()) is None


# ---------- settings ----------

def test_switching_on_starts_from_now(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CONFIG_FILE", tmp_path / "config.json")
    client = TestClient(app)
    body = Config(destinations=[dest()]).model_dump()
    before = time.time()
    since = client.put("/api/config", json=body).json()["destinations"][0]["since"]
    assert since >= before
    body["destinations"][0]["since"] = 0          # an older copy of the page doesn't undo it
    assert client.put("/api/config", json=body).json()["destinations"][0]["since"] == since


def test_sending_needs_url_and_token():
    with pytest.raises(ValueError):
        Destination(name="hub", mode="auto")
