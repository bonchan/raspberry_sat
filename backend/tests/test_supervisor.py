import asyncio
import os
import time

import pytest

from app import settings
from app.passes import output_busy
from app.supervisor import Supervisor, parse_line


def test_parse_satdump_line():
    raw = "\x1b[32m[13:25:14 - 15/10/2026] (I) Starting SatDump v1.2.2\x1b[0m\n"
    assert parse_line(raw) == ("info", "Starting SatDump v1.2.2")
    assert parse_line("[13:25:14 - 15/10/2026] (E) Could not connect to Rotcld!") == ("error", "Could not connect to Rotcld!")


def test_parse_other_line():
    assert parse_line("plain text\n") == ("info", "plain text")


def test_output_busy(tmp_path):
    assert not output_busy(tmp_path / "missing")

    old = tmp_path / "2026-10-14_10-00_meteor_m2-x_lrpt_137.900 MHz" / "MSU-MR"
    old.mkdir(parents=True)
    image = old / "rgb.png"
    image.write_bytes(b"x")
    an_hour_ago = time.time() - 3600
    os.utime(image, (an_hour_ago, an_hour_ago))
    assert not output_busy(tmp_path)

    new = tmp_path / "2026-10-15_10-00_meteor_m2-x_lrpt_137.900 MHz"
    new.mkdir()
    (new / "meteor.cadu").write_bytes(b"x")
    assert output_busy(tmp_path)


@pytest.fixture
def fake_satdump(tmp_path, monkeypatch):
    for name, path in (("CONFIG_FILE", tmp_path / "config.json"), ("SATDUMP_DIR", tmp_path / "satdump"),
                       ("PASSES_DIR", tmp_path / "passes"), ("LOGS_DIR", tmp_path / "logs")):
        monkeypatch.setattr(settings, name, path)

    def make(script: str):
        fake = tmp_path / "satdump-fake"
        fake.write_text("#!/bin/sh\n" + script)
        fake.chmod(0o755)
        monkeypatch.setattr(settings, "SATDUMP_BIN", str(fake))
    return make


async def wait_for(condition, seconds=5.0):
    for _ in range(int(seconds * 20)):
        if condition():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("timed out")


@pytest.mark.skipif(os.name == "nt", reason="the fake SatDump is a shell script")
def test_runs_logs_and_stops(fake_satdump, tmp_path):
    fake_satdump("echo '[10:00:00 - 15/10/2026] (I) fake satdump up'\nexec sleep 60\n")

    async def scenario():
        sup = Supervisor()
        job = asyncio.create_task(sup.run())
        await wait_for(lambda: any(line.text == "fake satdump up" for line in sup.lines))
        assert sup.state == "running"
        assert (tmp_path / "satdump" / "autotrack.json").exists()
        await sup.stop()
        await wait_for(lambda: sup.state == "stopped")
        job.cancel()

    asyncio.run(scenario())


@pytest.mark.skipif(os.name == "nt", reason="the fake SatDump is a shell script")
def test_crash_waits_then_restarts(fake_satdump, monkeypatch):
    monkeypatch.setattr("app.supervisor.FIRST_BACKOFF", 0.2)
    fake_satdump("echo started\nexit 3\n")

    async def scenario():
        sup = Supervisor()
        job = asyncio.create_task(sup.run())
        await wait_for(lambda: sum(line.text == "started" for line in sup.lines) >= 2)
        assert sup.exit_code == 3
        await sup.shutdown()
        job.cancel()

    asyncio.run(scenario())
