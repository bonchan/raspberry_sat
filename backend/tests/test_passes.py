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


SATDUMP_NAME = "2026-10-15_19-21_meteor_m2-x_lrpt_137.9 MHz"


def test_satdump_minus_one_timestamp_falls_back_to_the_folder_name(tmp_path):
    folder = make_pass(tmp_path, name=SATDUMP_NAME, satellite="METEOR-M2-4")
    (folder / "dataset.json").write_text(json.dumps(
        {"products": ["MSU-MR"], "satellite": "METEOR-M2-4", "timestamp": -1}))
    folder = passes.finalize(folder)
    assert folder.name == "2026-10-15_1921Z_meteor-m2-4"
    assert passes.load_pass(folder)["time"] == passes.time_from_name(SATDUMP_NAME)


def test_repair_passes_finished_with_a_1969_date(tmp_path):
    folder = passes.finalize(make_pass(tmp_path, name=SATDUMP_NAME, satellite="METEOR-M2-4"))
    meta = passes.load_pass(folder)
    meta["time"] = -1                       # what the first version stored
    passes.write_meta(folder, meta)
    folder = folder.rename(folder.with_name("1969-12-31_2359Z_meteor-m2-4"))

    assert passes.repair(tmp_path) == [("1969-12-31_2359Z_meteor-m2-4", "2026-10-15_1921Z_meteor-m2-4")]
    assert passes.repair(tmp_path) == []            # nothing left to fix
    assert passes.plausible_time(passes.load_pass(tmp_path / "2026-10-15_1921Z_meteor-m2-4")["time"])


def test_unknown_meteor_is_named_from_the_orbits(tmp_path):
    folder = make_pass(tmp_path, name="2026-10-15_21-02_meteor_m2-x_lrpt_137.9 MHz", satellite="Unknown Meteor")
    asked = []
    guess = lambda when: asked.append(when) or "METEOR-M2 4"
    folder = passes.finalize(folder, guess)
    assert folder.name.endswith("_meteor-m2-4")
    assert passes.load_pass(folder)["satellite"] == "METEOR-M2 4"
    assert asked                                     # asked with the pass's time

    named = make_pass(tmp_path, name="named", satellite="METEOR-M2-3")
    assert passes.load_pass(passes.finalize(named, guess))["satellite"] == "METEOR-M2-3"   # SatDump's name wins


def test_repair_names_unknown_passes(tmp_path):
    folder = passes.finalize(make_pass(tmp_path, name="2026-10-15_21-02_meteor_m2-x_lrpt_137.9 MHz",
                                       satellite="Unknown Meteor"))
    assert folder.name.endswith("_unknown-meteor")
    assert passes.repair(tmp_path, lambda when: None) == []                 # orbits don't know either
    fixed = passes.repair(tmp_path, lambda when: "METEOR-M2 4")
    assert fixed == [(folder.name, folder.name.replace("unknown-meteor", "meteor-m2-4"))]


def test_finalize_stores_orbit_and_signal(tmp_path):
    orbit = {"aos": STARTED - 60, "los": STARTED + 840, "max_el": 47.3, "track": [[10.0, 0.0], [190.0, 0.0]]}
    signal = {"peak_snr": 12.1, "mean_snr": 7.4, "locked": 0.9, "seconds": 780}
    seen = []

    samples = [{"t": 1000.5, "snr": 6.123456, "deframer_lock": True},
               {"t": 1001.5, "snr": 7.0, "deframer_lock": False}]

    def facts(started, satellite):
        seen.append((started, satellite))
        return {"orbit": orbit, "signal": signal, "samples": samples}

    folder = passes.finalize(make_pass(tmp_path), facts=facts)
    meta = passes.load_pass(folder)
    assert seen == [(STARTED, "METEOR-M2-3")]
    assert meta["orbit"] == orbit and meta["signal"] == signal
    assert "samples" not in meta                        # kept out of pass.json, which the list reads
    assert passes.load_samples(folder)[0] == {"t": 1000.5, "snr": 6.123, "deframer_lock": True}
    assert passes.SAMPLES not in [f["path"] for f in passes.other_files(folder)]
    listed = passes.list_passes(tmp_path)["passes"][0]
    assert (listed["max_el"], listed["peak_snr"], listed["locked"]) == (47.3, 12.1, 0.9)


def test_add_orbits_to_earlier_passes(tmp_path):
    folder = passes.finalize(make_pass(tmp_path))
    meta = passes.load_pass(folder)
    del meta["orbit"]                                   # as saved before pass.json had one
    passes.write_meta(folder, meta)

    assert passes.add_orbits(tmp_path, lambda started, satellite: {}) == 0      # no orbit data yet
    assert "orbit" not in passes.load_pass(folder)
    assert passes.add_orbits(tmp_path, lambda started, satellite: {"orbit": {"max_el": 33.0}}) == 1
    assert passes.load_pass(folder)["orbit"] == {"max_el": 33.0}
    assert passes.add_orbits(tmp_path, lambda started, satellite: {"orbit": {"max_el": 99.0}}) == 0   # done once


def test_refresh_signal_summaries_adds_first_and_last_sync(tmp_path):
    folder = passes.finalize(make_pass(tmp_path))
    meta = passes.load_pass(folder)
    meta["signal"] = {"peak_snr": 8.0, "mean_snr": 5.0, "locked": 0.5, "seconds": 2}    # saved before first/last sync
    passes.write_meta(folder, meta)
    passes.write_samples(folder, [{"t": 10.0, "el": 12.0, "az": 170.0, "snr": 3.0, "deframer_lock": False},
                                  {"t": 11.0, "el": 15.0, "az": 168.0, "snr": 8.0, "deframer_lock": True},
                                  {"t": 12.0, "el": 19.0, "az": 165.0, "snr": 6.0, "deframer_lock": True}])
    assert passes.refresh_signal_summaries(tmp_path) == 1
    signal = passes.load_pass(folder)["signal"]
    assert signal["first_sync"] == {"t": 11.0, "el": 15.0, "az": 168.0}
    assert signal["last_sync"]["el"] == 19.0
    assert passes.refresh_signal_summaries(tmp_path) == 0                              # done once
    listed = passes.list_passes(tmp_path)["passes"][0]
    assert listed["first_sync"]["el"] == 15.0 and listed["mean_snr"] == 5.7


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
