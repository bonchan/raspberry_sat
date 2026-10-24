import time
from pathlib import Path

from app import passes, processing, tasks
from app.processing import Progress, expected_images, percent
from app.supervisor import Supervisor

DAY = 86400
NOW = 1_800_000_000.0


def earlier(satellite: str, time_: float, images: int) -> dict:
    return {"satellite": satellite, "time": time_, "image_count": images}


def test_expects_as_many_images_as_passes_at_the_same_time_of_day():
    history = [                                                 # newest first, like list_passes
        earlier("METEOR-M2 4", NOW - DAY + 600, 40),            # same satellite, same slot
        earlier("METEOR-M2 4", NOW - DAY + 12 * 3600, 22),      # same satellite, twelve hours apart (night)
        earlier("METEOR-M2 4", NOW - 2 * DAY - 300, 44),
        earlier("METEOR-M2 3", NOW - DAY, 10),
        earlier("METEOR-M2 4", NOW - 3 * DAY, 0),               # nothing received: not counted
    ]
    assert expected_images(history, "Meteor-M2-4", NOW) == 42
    assert expected_images(history, "METEOR-M2 4", NOW + 12 * 3600) == 22
    assert expected_images(history, "METEOR-M2 3", NOW + 12 * 3600) == 10     # no pass in that slot yet
    assert expected_images(history, None, NOW) == 31                            # any: median of the latest five
    assert expected_images([], "METEOR-M2 4", NOW) is None


def test_percent_in_steps():
    assert percent(None, 0, 40) == 0
    assert percent(50.0, 0, 40) == 5                # SatDump's own progress in the first step
    assert percent(100.0, 20, 40) == 50             # half the images expected
    assert percent(100.0, 60, 40) == 89             # more than expected: still under 90 until SatDump is done
    assert percent(100.0, 5, None) is None          # no earlier pass to go by


def make_folder(root: Path, images: int) -> Path:
    folder = root / "2026-10-15_19-21_meteor_m2-x_lrpt_137.9 MHz"
    (folder / "MSU-MR").mkdir(parents=True)
    (folder / "meteor_m2-x_lrpt.cadu").write_bytes(b"\0" * 1024)
    for i in range(images):
        (folder / "MSU-MR" / f"msu_mr_{i}.png").write_bytes(b"png")
    return folder


def fake_history(monkeypatch, tmp_path, count: int = 40) -> None:
    monkeypatch.setattr(tasks, "guess_satellite", lambda when: "METEOR-M2 4")
    history = {"passes": [earlier("METEOR-M2 4", passes.time_from_name(
        "2026-10-14_19-25_meteor_m2-x_lrpt_137.9 MHz"), count)], "in_progress": []}
    monkeypatch.setattr(passes, "list_passes", lambda root: history)
    monkeypatch.setattr(processing.settings, "PASSES_DIR", tmp_path)


IDLE = {"folder": None, "done": 0, "total": 0}


def test_follows_a_pass_from_the_frames_to_the_thumbnails(monkeypatch, tmp_path):
    fake_history(monkeypatch, tmp_path)
    folder = make_folder(tmp_path, 0)
    progress = Progress()

    first = progress.work([folder], False, IDLE, None, "products", 50.0)
    assert first == {"pass": folder.name, "satellite": "METEOR-M2 4", "step": "decode", "percent": 5}

    for i in range(10):
        (folder / "MSU-MR" / f"rgb_{i}.png").write_bytes(b"png")
    assert progress.work([folder], False, IDLE, None, "products", 100.0)["percent"] == 30
    assert progress.work([folder], False, IDLE, None, None, None)["step"] == "images"

    # SatDump is done; the app hasn't started on the thumbnails yet, then makes them
    assert progress.work([], False, IDLE, (folder, time.time()), None, None)["percent"] == 90
    making = {"folder": folder, "done": 5, "total": 10}
    assert progress.work([], False, making, (folder, time.time()), None, None)["percent"] == 95

    (folder / passes.META).write_text("{}")                     # finished
    assert progress.work([], False, IDLE, (folder, time.time()), None, None) is None


def test_the_pass_being_received_is_not_processing(monkeypatch, tmp_path):
    fake_history(monkeypatch, tmp_path)
    folder = make_folder(tmp_path, 0)
    assert Progress().work([folder], True, IDLE, None, None, None) is None


def test_a_pass_satdump_never_finished_stops_showing(monkeypatch, tmp_path):
    fake_history(monkeypatch, tmp_path)
    folder = make_folder(tmp_path, 3)
    long_ago = time.time() - processing.DONE_GRACE - 1
    assert Progress().work([], False, IDLE, (folder, long_ago), None, None) is None


def test_supervisor_follows_the_steps_after_los():
    sup = Supervisor()
    folder = "/home/bon/raspberry_sat_data/passes/2026-10-15_19-21_meteor_m2-x_lrpt_137.9 MHz"
    sup._watch(f"Generated folder name : {folder}")
    sup._watch("Processing data to level products")
    assert (sup.step, sup.step_progress) == ("products", None)
    sup._watch("Progress 45.300000%")
    assert sup.step_progress == 45.3
    sup._watch("Progress nan%, SNR : 0.000000dB, Peak SNR: 0.303229dB")    # live stats, not a step
    assert sup.step_progress == 45.3
    sup._watch("Pipeline Processing Done!")
    assert (sup.step, sup.step_progress) == (None, None)
    assert sup.last_done[0] == Path(folder)
