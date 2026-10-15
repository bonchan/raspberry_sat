import json
import os
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import passes, settings
from app.main import app

STARTED = 1791810618.85        # 2026-10-12 13:10:18 UTC, as in a real dataset.json


def make_png(path, color=(200, 180, 150), gap_rows=0, size=(300, 200)):
    """An image like SatDump's, with `gap_rows` black rows in the middle (lost signal)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, color)
    if gap_rows:
        top = (size[1] - gap_rows) // 2
        img.paste((0, 0, 0), (0, top, size[0], top + gap_rows))
    img.save(path)


def make_pass(passes_dir, name="20261012 meteor m2-3 001", satellite="METEOR-M2-3", night=False, age=3600):
    folder = passes_dir / name
    instrument = folder / "MSU-MR"
    make_png(instrument / "msu_mr_rgb_MCIR_corrected.png", (5, 5, 5) if night else (90, 120, 160), gap_rows=40)
    make_png(instrument / "msu_mr_rgb_MSA_corrected.png", (200, 180, 150))
    make_png(instrument / "MSU-MR-1.png", (120, 120, 120))
    (instrument / "product.cbor").write_bytes(b"\x00" * 10)
    (folder / "meteor_m2-x_lrpt.cadu").write_bytes(b"\x00" * 100)
    (folder / "dataset.json").write_text(json.dumps(
        {"products": ["MSU-MR"], "satellite": satellite, "timestamp": STARTED}))
    old = time.time() - age
    for f in folder.rglob("*"):
        os.utime(f, (old, old))
    return folder


def test_describe_image():
    d = passes.describe_image("MSU-MR/msu_mr_rgb_MSA_corrected_map.png")
    assert (d["instrument"], d["name"], d["variants"]) == ("MSU-MR", "MSA", ["corrected", "map"])
    d = passes.describe_image("MSU-MR/msu_mr_3.9_um_Shortwave_IR_(Uncalibrated)_map.png")
    assert (d["name"], d["variants"]) == ("3.9 um Shortwave IR (Uncalibrated)", ["map"])
    d = passes.describe_image("MSU-MR/msu_mr_rgb_MSU-MR_124_False_Color.png")
    assert (d["name"], d["variants"]) == ("MSU-MR 124 False Color", [])
    assert passes.describe_image("MSU-MR/MSU-MR-1.png")["name"] == "MSU-MR-1"


def test_finalize_renames_and_describes(tmp_path):
    folder = passes.finalize(make_pass(tmp_path))
    assert folder.name == "2026-10-12_1310Z_meteor-m2-3"
    meta = passes.load_pass(folder)
    assert meta["satellite"] == "METEOR-M2-3"
    assert meta["source_name"] == "20261012 meteor m2-3 001"
    assert meta["main"] == "MSU-MR/msu_mr_rgb_MCIR_corrected.png"
    assert meta["coverage"] == pytest.approx(0.8, abs=0.02)     # 40 of 200 rows lost
    assert len(meta["images"]) == 3
    for image in meta["images"]:
        assert passes.thumb_path(folder, image["path"]).is_file()
        assert (image["width"], image["height"]) == (300, 200)


def test_night_pass_falls_back_from_black_image(tmp_path):
    folder = passes.finalize(make_pass(tmp_path, night=True))
    assert passes.load_pass(folder)["main"] == "MSU-MR/msu_mr_rgb_MSA_corrected.png"


def test_name_clash_gets_a_suffix(tmp_path):
    passes.finalize(make_pass(tmp_path, name="a"))
    second = passes.finalize(make_pass(tmp_path, name="b"))
    assert second.name == "2026-10-12_1310Z_meteor-m2-3-2"


def test_finalize_ready_leaves_fresh_folders(tmp_path):
    make_pass(tmp_path, name="old")
    make_pass(tmp_path, name="fresh", satellite="METEOR-M2-4", age=10)
    done, errors = passes.finalize_ready(tmp_path)
    assert [f.name for f in done] == ["2026-10-12_1310Z_meteor-m2-3"]
    assert errors == []
    listing = passes.list_passes(tmp_path)
    assert [p["id"] for p in listing["passes"]] == ["2026-10-12_1310Z_meteor-m2-3"]
    assert [p["id"] for p in listing["in_progress"]] == ["fresh"]


def test_folder_without_images_still_finishes(tmp_path):
    folder = tmp_path / "2026-10-15_10-31_meteor_m2-x_lrpt_137.900 MHz"
    folder.mkdir()
    (folder / "meteor_m2-x_lrpt.cadu").write_bytes(b"")
    old = time.time() - 3600
    os.utime(folder / "meteor_m2-x_lrpt.cadu", (old, old))
    done, _ = passes.finalize_ready(tmp_path)
    meta = passes.load_pass(done[0])
    assert meta["satellite"] == "unknown" and meta["main"] is None and meta["images"] == []


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "PASSES_DIR", tmp_path)
    passes.finalize(make_pass(tmp_path))
    return TestClient(app)


def test_api_list_detail_and_images(client):
    listing = client.get("/api/passes").json()
    pass_id = listing["passes"][0]["id"]
    detail = client.get(f"/api/passes/{pass_id}").json()
    assert detail["main"] == "MSU-MR/msu_mr_rgb_MCIR_corrected.png"
    assert {f["path"] for f in detail["files"]} >= {"dataset.json", "meteor_m2-x_lrpt.cadu"}
    for kind in ("thumb", "large", "file"):
        r = client.get(f"/api/passes/{pass_id}/{kind}/MSU-MR/msu_mr_rgb_MCIR_corrected.png")
        assert r.status_code == 200, kind


def test_api_refuses_paths_out_of_the_pass(client):
    pass_id = client.get("/api/passes").json()["passes"][0]["id"]
    assert client.get(f"/api/passes/{pass_id}/file/..%2F..%2Fconfig.json").status_code == 404
    assert client.get(f"/api/passes/{pass_id}/file/pass.json").status_code == 404
    assert client.get("/api/passes/..").status_code == 404


def test_api_delete(client, tmp_path):
    pass_id = client.get("/api/passes").json()["passes"][0]["id"]
    assert client.delete(f"/api/passes/{pass_id}").status_code == 200
    assert not (tmp_path / pass_id).exists()
