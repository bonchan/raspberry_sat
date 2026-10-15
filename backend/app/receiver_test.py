"""'Test receiver' in Settings: is the SDR there, usable, and set up the way SatDump needs it.

One test per SatDump source type (TESTS below); a type without one reports supported=False.
Each check is {"id", "status": ok | warn | fail, "detail": facts, "reason": code or None};
the page words the ids and reasons in its own language.
"""

import re
import subprocess
from collections.abc import Callable
from pathlib import Path

from app.config import Sdr

TEST_SECONDS = 4
SATDUMP_RTLSDR_PLUGIN = Path("/usr/lib/satdump/plugins/librtlsdr_sdr_support.so")


def check(id: str, status: str, detail: str = "", reason: str | None = None) -> dict:
    return {"id": id, "status": status, "detail": detail, "reason": reason}


def effective_gain(gain: float, steps: list[float]) -> float | None:
    """The step SatDump's rtlsdr source uses: the first one at or above the setting (it rounds up)."""
    if not steps:
        return None
    wanted = int(gain * 10)
    return next((s for s in sorted(steps) if round(s * 10) >= wanted), max(steps))


def linked_librtlsdr(plugin: Path = SATDUMP_RTLSDR_PLUGIN) -> str | None:
    """Which librtlsdr SatDump's RTL-SDR plugin loads (Debian's, or the RTL-SDR Blog one in /usr/local)."""
    try:
        out = subprocess.run(["ldd", str(plugin)], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"librtlsdr\.so\S*\s+=>\s+(\S+)", out)
    return m.group(1) if m else None


def parse_rtl_test(output: str, satdump_lib: str | None, gain: float) -> dict:
    checks = []
    devices = re.findall(r"^\s*\d+:\s+(.+)$", output, re.M)
    found = re.search(r"Found (\d+) device", output)
    if "No supported devices found" in output or not found or int(found.group(1)) == 0:
        checks.append(check("found", "fail", reason="none_found"))
        return {"checks": checks, "gains": [], "effective_gain": None}
    checks.append(check("found", "ok", "; ".join(devices)))

    is_v4 = any("V4" in d for d in devices)
    if "usb_claim_interface error" in output:
        checks.append(check("open", "fail", reason="busy"))
    elif "Failed to open" in output:
        checks.append(check("open", "fail", reason="open_failed"))
    else:
        checks.append(check("open", "ok", (re.search(r"Using device (.+)", output) or [None, ""])[1]))

    tuner = re.search(r"Found (.+?) tuner", output)
    if tuner is None:
        checks.append(check("tuner", "warn", reason="no_tuner"))
    elif "PLL not locked" in output:
        checks.append(check("tuner", "warn", tuner.group(1), reason="pll"))
    else:
        checks.append(check("tuner", "ok", tuner.group(1)))

    if is_v4:
        if "Blog V4 Detected" in output:
            checks.append(check("driver", "ok", "RTL-SDR Blog"))
        else:
            checks.append(check("driver", "fail", reason="no_v4_support"))
        if satdump_lib is None:
            checks.append(check("satdump_driver", "warn", reason="unknown"))
        elif satdump_lib.startswith("/usr/local/"):
            checks.append(check("satdump_driver", "ok", satdump_lib))
        else:
            checks.append(check("satdump_driver", "fail", satdump_lib, reason="old_driver"))
    elif satdump_lib:
        checks.append(check("satdump_driver", "ok", satdump_lib))

    lost = re.search(r"Samples per million lost \(minimum\): (\d+)", output)
    if lost is None:
        checks.append(check("samples", "warn", reason="no_summary"))
    else:
        per_million = int(lost.group(1))
        checks.append(check("samples", "ok" if per_million < 100 else "warn", f"{per_million}",
                            reason=None if per_million < 100 else "samples_lost"))

    gains = []
    g = re.search(r"Supported gain values \(\d+\):\s*([\d.\s]+)", output)
    if g:
        gains = [float(v) for v in g.group(1).split()]
    return {"checks": checks, "gains": gains, "effective_gain": effective_gain(gain, gains)}


def test_rtlsdr(sdr: Sdr) -> dict:
    # rtl_test streams until interrupted; SIGINT after a few seconds makes it print the lost-samples summary
    cmd = ["timeout", "-s", "INT", str(TEST_SECONDS), "rtl_test", "-s", str(sdr.samplerate)]
    if sdr.source_id:
        cmd += ["-d", sdr.source_id]                    # rtl_test takes an index or a serial number
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TEST_SECONDS + 15)
    except FileNotFoundError:
        return {"checks": [check("found", "fail", reason="not_installed")], "gains": [], "effective_gain": None,
                "output": ""}
    except subprocess.TimeoutExpired:
        return {"checks": [check("found", "fail", reason="hung")], "gains": [], "effective_gain": None,
                "output": ""}
    output = (r.stdout + r.stderr).strip()
    if "command not found" in output or r.returncode == 127:
        return {"checks": [check("found", "fail", reason="not_installed")], "gains": [], "effective_gain": None,
                "output": output}
    return {**parse_rtl_test(output, linked_librtlsdr(), sdr.gain), "output": output}


TESTS: dict[str, Callable[[Sdr], dict]] = {
    "rtlsdr": test_rtlsdr,
    # "airspy": test_airspy, ... one function per SatDump source type
}


def run(sdr: Sdr) -> dict:
    test = TESTS.get(sdr.source)
    if test is None:
        return {"source": sdr.source, "supported": False, "ok": None, "checks": [], "gains": [],
                "effective_gain": None, "output": ""}
    result = test(sdr)
    ok = all(c["status"] != "fail" for c in result["checks"])
    return {"source": sdr.source, "supported": True, "ok": ok, **result}
