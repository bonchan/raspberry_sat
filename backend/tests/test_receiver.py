from fastapi.testclient import TestClient

from app import receiver_test
from app.config import Sdr
from app.main import app

# what rtl_test printed on the Pi: the RTL-SDR Blog V4 with Debian's old driver, then with the Blog driver
OLD_DRIVER = """Found 1 device(s):
  0:  RTLSDRBlog, Blog V4, SN: 00000001

Using device 0: Generic RTL2832U OEM
Found Rafael Micro R828D tuner
Supported gain values (29): 0.0 0.9 1.4 2.7 3.7 7.7 8.7 12.5 14.4 15.7 16.6 19.7 20.7 22.9 25.4 28.0 29.7 32.8 33.8 36.4 37.2 38.6 40.2 42.1 43.4 43.9 44.5 48.0 49.6
[R82XX] PLL not locked!
Sampling at 2048000 S/s.
No E4000 tuner found, aborting.
"""

BLOG_DRIVER = """Found 1 device(s):
  0:  RTLSDRBlog, Blog V4, SN: 00000001

Using device 0: Generic RTL2832U OEM
Found Rafael Micro R828D tuner
RTL-SDR Blog V4 Detected
Supported gain values (29): 0.0 0.9 1.4 2.7 3.7 7.7 8.7 12.5 14.4 15.7 16.6 19.7 20.7 22.9 25.4 28.0 29.7 32.8 33.8 36.4 37.2 38.6 40.2 42.1 43.4 43.9 44.5 48.0 49.6
Sampling at 1024000 S/s.

Info: This tool will continuously read from the device, and report if
samples get lost. If you observe no further output, everything is fine.

Reading samples in async mode...
lost at least 68 bytes
Signal caught, exiting!

User cancel, exiting...
Samples per million lost (minimum): 4
"""


def statuses(result):
    return {c["id"]: (c["status"], c["reason"]) for c in result["checks"]}


def test_blog_driver_all_good():
    r = receiver_test.parse_rtl_test(BLOG_DRIVER, "/usr/local/lib/librtlsdr.so.0", 38.6)
    assert all(c["status"] == "ok" for c in r["checks"])
    assert r["checks"][0]["detail"] == "RTLSDRBlog, Blog V4, SN: 00000001"
    assert len(r["gains"]) == 29 and r["effective_gain"] == 38.6


def test_old_driver_is_flagged():
    s = statuses(receiver_test.parse_rtl_test(OLD_DRIVER, "/lib/aarch64-linux-gnu/librtlsdr.so.0", 30))
    assert s["driver"] == ("fail", "no_v4_support")
    assert s["satdump_driver"] == ("fail", "old_driver")
    assert s["tuner"] == ("warn", "pll")


def test_busy_and_missing_dongle():
    busy = BLOG_DRIVER.replace("Found Rafael", "usb_claim_interface error -6\nFound Rafael")
    assert statuses(receiver_test.parse_rtl_test(busy, None, 30))["open"] == ("fail", "busy")
    assert statuses(receiver_test.parse_rtl_test("No supported devices found.\n", None, 30)) == {
        "found": ("fail", "none_found")}


def test_satdump_rounds_gain_up():
    steps = [28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2]
    assert receiver_test.effective_gain(35, steps) == 36.4
    assert receiver_test.effective_gain(33.8, steps) == 33.8
    assert receiver_test.effective_gain(99, steps) == 40.2


def test_receiver_types_without_a_test():
    r = receiver_test.run(Sdr(source="airspy"))
    assert r["supported"] is False and r["checks"] == []


def test_api(monkeypatch):
    monkeypatch.setitem(receiver_test.TESTS, "rtlsdr",
                        lambda sdr: {**receiver_test.parse_rtl_test(BLOG_DRIVER, "/usr/local/lib/librtlsdr.so.0", sdr.gain),
                                     "output": BLOG_DRIVER})
    r = TestClient(app).post("/api/receiver/test", json=Sdr().model_dump()).json()
    assert r["ok"] is True and r["supported"] is True
