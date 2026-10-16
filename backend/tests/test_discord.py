import asyncio
import json
import os
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app import discord, passes, settings, tasks
from app.config import Config, Discord, save_config
from app.main import app

STARTED = 1791810618.85        # 2026-10-12 13:10:18 UTC
CHANNEL = "123456789012345678"
SERVER = "876543210987654321"


def make_png(path, color):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (300, 200), color).save(path)


def finished_pass(passes_dir, night=False):
    """A finished pass with MCIR (main), MSA in two variants, and a channel image."""
    folder = passes_dir / "20261012 meteor m2-3 001"
    sky = (5, 5, 5) if night else (200, 180, 150)
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MCIR_corrected.png", (90, 120, 160))
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MCIR.png", (90, 120, 160))
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MSA_corrected.png", sky)
    make_png(folder / "MSU-MR" / "msu_mr_rgb_MSA_corrected_map.png", sky)
    make_png(folder / "MSU-MR" / "MSU-MR-1.png", sky)
    (folder / "dataset.json").write_text(json.dumps({"satellite": "METEOR-M2-3", "timestamp": STARTED}))
    old = time.time() - 3600
    for f in folder.rglob("*"):
        os.utime(f, (old, old))
    return passes.finalize(folder)


def bot(**kwargs) -> Discord:
    return Discord(mode="manual", bot_token="secret", channel_id=CHANNEL, **kwargs)


class FakeDiscord:
    """Answers like Discord's API and keeps the requests."""

    def __init__(self, fail: tuple[int, dict] | None = None):
        self.requests: list[httpx.Request] = []
        self.fail = fail

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(self.fail[0], json=self.fail[1])
        if request.method == "GET":
            return httpx.Response(200, json={"id": CHANNEL, "guild_id": SERVER, "name": "satellites"})
        return httpx.Response(200, json={"id": "111", "channel_id": CHANNEL})


@pytest.fixture
def fake(monkeypatch):
    def install(fail=None):
        f = FakeDiscord(fail)
        monkeypatch.setattr(discord, "transport", httpx.MockTransport(f))
        return f
    return install


# ---------- what gets posted ----------

def test_one_image_per_composite_main_first(tmp_path):
    meta = passes.load_pass(finished_pass(tmp_path))
    picked = discord.pick_images(meta, [])
    assert [i["path"] for i in picked] == [
        "MSU-MR/msu_mr_rgb_MCIR_corrected.png",     # the main image, not the raw MCIR
        "MSU-MR/msu_mr_rgb_MSA_corrected.png",      # corrected before corrected + map
        "MSU-MR/MSU-MR-1.png",
    ]


def test_black_images_and_unwanted_composites_are_left_out(tmp_path):
    meta = passes.load_pass(finished_pass(tmp_path, night=True))
    assert [i["name"] for i in discord.pick_images(meta, [])] == ["MCIR"]
    meta = passes.load_pass(finished_pass(tmp_path / "day"))
    assert [i["name"] for i in discord.pick_images(meta, ["msa"])] == ["MSA"]


def test_at_most_ten_images():
    images = [{"path": f"X/{n}.png", "instrument": "X", "name": f"c{n:02d}", "variants": [], "mean": 100}
              for n in range(15)]
    assert len(discord.pick_images({"images": images, "main": None}, [])) == discord.MAX_FILES


def test_message_text():
    meta = {"satellite": "METEOR-M2-3", "time": STARTED, "coverage": 0.874,
            "orbit": {"aos": STARTED, "los": STARTED + 780, "tca": STARTED + 390, "max_el": 54.4,
                      "aos_az": 315, "los_az": 135},
            "signal": {"peak_snr": 12.34, "mean_snr": 8.1, "locked": 0.92, "seconds": 700}}
    images = [{"name": "MCIR"}, {"name": "MSA"}]
    text = discord.message_text(meta, images, "roof_top", "en")
    assert text.startswith("## METEOR-M2-3\n")
    assert f"<t:{int(STARTED)}:F> · 13:10 UTC" in text
    assert "Highest elevation **54°**" in text and "NW → SE" in text and "(13 min)" in text
    assert "peak 12.3 dB, average 8.1 dB · locked 92%" in text
    assert "Received 87% of the main image" in text
    assert "Images: MCIR · MSA" in text
    assert text.endswith("-# Station roof\\_top")
    assert "NO → SE" in discord.message_text(meta, images, "x", "es")
    assert "No images" in discord.message_text({"time": STARTED}, [], "x", "en")


def test_images_shrink_to_fit(tmp_path, monkeypatch):
    folder = finished_pass(tmp_path)
    images = discord.pick_images(passes.load_pass(folder), [])
    files = discord.encode_images(folder, images)
    assert [name for name, _ in files] == ["MCIR_corrected.jpg", "MSA_corrected.jpg", "MSU-MR-1.jpg"]
    monkeypatch.setattr(discord, "MAX_BYTES", len(files[0][1]) + 1)
    assert len(discord.encode_images(folder, images)) == 1     # the rest is left out


# ---------- sending ----------

def test_post_pass_sends_one_message_and_notes_it(tmp_path, fake):
    folder = finished_pass(tmp_path)
    api = fake()
    note = asyncio.run(discord.post_pass(folder, Config(discord=bot())))
    assert note["url"] == f"https://discord.com/channels/{SERVER}/{CHANNEL}/111"
    assert note["channel"] == "satellites" and note["images"] == 3

    get, post = api.requests
    assert get.url.path == f"/api/v10/channels/{CHANNEL}"
    assert post.headers["Authorization"] == "Bot secret"
    assert post.headers["User-Agent"].startswith("DiscordBot (")
    body = post.read()
    assert body.count(b'filename="') == 3 and b"payload_json" in body and b"## METEOR-M2-3" in body
    assert passes.load_pass(folder)["discord"]["url"] == note["url"]


def test_failure_is_explained_and_noted(tmp_path, fake):
    folder = finished_pass(tmp_path)
    fake(fail=(403, {"code": 50001, "message": "Missing Access"}))
    with pytest.raises(discord.DiscordError, match="invite link"):
        asyncio.run(discord.post_pass(folder, Config(discord=bot())))
    assert "Missing Access" in passes.load_pass(folder)["discord"]["error"]


def test_wrong_token(fake):
    fake(fail=(401, {"code": 0, "message": "401: Unauthorized"}))
    with pytest.raises(discord.DiscordError, match="token is wrong"):
        asyncio.run(discord.send_test(bot(), "en"))


def test_test_message_is_plain_json(fake):
    api = fake()
    assert asyncio.run(discord.send_test(bot(), "en"))["channel"] == "satellites"
    assert json.loads(api.requests[1].read())["content"].startswith("raspberry_sat can post here")


# ---------- settings ----------

def test_discord_settings():
    assert Discord().mode == "off"
    with pytest.raises(ValidationError):
        Discord(mode="auto")                                 # no token, no channel
    d = Discord(bot_token="  Bot abc.def \n", channel_id=f"https://discord.com/channels/{SERVER}/{CHANNEL}")
    assert (d.bot_token, d.channel_id) == ("abc.def", CHANNEL)
    with pytest.raises(ValidationError):
        Discord(channel_id="#satellites")


def test_old_discord_settings_load_as_off():
    config = Config.model_validate({"discord": {"enabled": True, "webhook_url": "", "composites": [],
                                                "post_failed": False}})
    assert config.discord.mode == "off"


# ---------- when it posts ----------

@pytest.fixture
def config_file(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    monkeypatch.setattr(settings, "CONFIG_FILE", path)
    monkeypatch.setattr(settings, "PASSES_DIR", tmp_path / "passes")
    return path


@pytest.mark.parametrize("mode, posts", [("auto", True), ("manual", False), ("off", False)])
def test_only_automatic_mode_posts_after_processing(config_file, fake, mode, posts):
    cfg = bot().model_copy(update={"mode": mode})
    save_config(config_file, Config(discord=cfg))
    folder = finished_pass(settings.PASSES_DIR)
    api = fake()
    asyncio.run(tasks.pass_finished(folder))
    assert bool(api.requests) == posts
    assert ("discord" in passes.load_pass(folder)) == posts


def test_post_button(config_file, fake):
    folder = finished_pass(settings.PASSES_DIR)
    client = TestClient(app)
    save_config(config_file, Config())
    assert client.post(f"/api/passes/{folder.name}/discord").status_code == 409     # posting is off
    save_config(config_file, Config(discord=bot()))
    fake()
    r = client.post(f"/api/passes/{folder.name}/discord")
    assert r.status_code == 200 and r.json()["channel"] == "satellites"
    assert client.get(f"/api/passes/{folder.name}").json()["discord"]["images"] == 3
    fake(fail=(404, {"code": 10003, "message": "Unknown Channel"}))
    r = client.post(f"/api/passes/{folder.name}/discord")
    assert r.status_code == 502 and "Copy Channel ID" in r.json()["detail"]
