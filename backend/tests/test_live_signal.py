import json

import cbor2

from app import passes, tasks
from app.tasks import LiveSignalFile, Tracker, load_live_signal


def receiving_tracker(samples):
    tracker = Tracker()
    tracker.pass_started = 1000.0
    tracker.history = list(samples)
    return tracker


def test_live_signal_is_written_as_it_comes_and_read_back(tmp_path):
    path = tmp_path / "live_signal.jsonl"
    live = LiveSignalFile(path)
    tracker = receiving_tracker([{"t": 1000.0, "snr": 5.0, "deframer_lock": True}])
    live.save(tracker, 2000.0)
    tracker.history.append({"t": 1001.0, "snr": 6.0, "deframer_lock": True})
    live.save(tracker, 2001.0)                    # too soon: waits for the next 5 s
    live.save(tracker, 2006.0)
    assert len(path.read_text().splitlines()) == 3                  # header and two samples, appended
    with path.open("a") as f:
        f.write('{"t": 1002.0, "snr"')                              # cut short by a power cut
    assert load_live_signal(path) == {"pass_started": 1000.0, "samples": tracker.history}

    tracker.pass_started, tracker.history = 3000.0, [{"t": 3000.0, "snr": 1.0, "deframer_lock": False}]
    live.save(tracker, 4000.0)                    # a new pass starts the file again
    assert load_live_signal(path)["pass_started"] == 3000.0
    assert load_live_signal(tmp_path / "missing.jsonl") is None


def test_pass_facts_use_the_signal_saved_before_a_restart(monkeypatch):
    monkeypatch.setattr(tasks, "tracker", Tracker())        # nothing in memory: the app just started
    monkeypatch.setattr(tasks, "recovered", {"pass_started": 1000.0,
                                             "samples": [{"t": 1000.0, "snr": 7.0, "deframer_lock": True}]})
    monkeypatch.setattr(tasks.orbits, "load_tles", lambda path: (_ for _ in ()).throw(OSError()))
    facts = tasks.pass_facts(1060.0, "METEOR-M2 3")
    assert facts["samples"][0]["snr"] == 7.0 and facts["signal"]["peak_snr"] == 7.0
    assert "signal" not in tasks.pass_facts(9000.0, "METEOR-M2 3")       # another pass's


def test_rebuild_samples_from_line_time_stamps():
    orbit = {"aos": 100.0, "los": 110.0, "track": [[350.0, 0.0], [10.0, 20.0]]}
    blocks = [101.2, 102.4, 106.1, 107.2]             # a gap between 102.4 and 106.1
    samples = passes.rebuild_samples(blocks, orbit)
    assert [s["t"] for s in samples] == [float(t) for t in range(100, 111)]
    assert [s["deframer_lock"] for s in samples] == [False, True, True, True, False, False, True, True, False, False, False]
    assert samples[5]["az"] == 0.0 and samples[5]["el"] == 10.0          # halfway, the short way past north
    assert passes.rebuild_samples(blocks, None)[0] == {"t": 102.0, "deframer_lock": True}


def test_rebuild_signal_for_a_pass_that_lost_it(tmp_path):
    folder = tmp_path / "2026-10-21_1003Z_meteor-m2-3"
    (folder / "MSU-MR").mkdir(parents=True)
    passes.write_meta(folder, {"satellite": "METEOR-M2-3", "time": 100.0, "images": [],
                               "orbit": {"aos": 100.0, "los": 110.0, "track": [[0.0, 0.0], [0.0, 20.0]]}})
    (folder / "MSU-MR" / "product.cbor").write_bytes(cbor2.dumps({
        "images": [{"timestamps": [100.0, 101.2, 102.4, 103.6]}],
        "projection_cfg": {"timefilter": {"type": "simple", "scan_time": 1.6, "max_diff": 10}},
    }))
    assert passes.rebuild_signal(folder)
    signal = passes.load_pass(folder)["signal"]
    assert signal["rebuilt"] is True and signal["peak_snr"] is None and signal["locked"] > 0
    assert passes.load_samples(folder)
    assert not passes.rebuild_signal(folder)          # never over a signal that is there
    assert json.loads((folder / passes.META).read_text())["signal"]["rebuilt"] is True
