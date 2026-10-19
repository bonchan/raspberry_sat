import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException

from app import networks, settings
from app.supervisor import supervisor

router = APIRouter(prefix="/system", tags=["system"])

SERVICE = "raspberry_sat"
THERMAL = Path("/sys/class/thermal/thermal_zone0/temp")
MEMINFO = Path("/proc/meminfo")
UPTIME = Path("/proc/uptime")
STAT = Path("/proc/stat")

# `vcgencmd get_throttled`: these bits for what is happening now, the same bits + 16 for since boot
THROTTLE_BITS = {0: "under_voltage", 1: "freq_capped", 2: "throttled", 3: "soft_temp_limit"}

# --no-block: systemctl only queues the job, so it is not cut short when our own service stops.
# A reboot or power off stops this service first, which lets SatDump finish a pass it is decoding.
POWER_COMMANDS = {
    "restart-app": f"systemctl --no-block restart {SERVICE}",
    "reboot": "systemctl --no-block reboot",
    "poweroff": "systemctl --no-block poweroff",
}


def git_version() -> str:
    """Short commit of the checkout, so the UI shows which code the Pi is running."""
    try:
        out = subprocess.run(
            ["git", "-C", str(settings.REPO_DIR), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() if out.returncode == 0 else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def temperature() -> float | None:
    """SoC temperature in °C, None where there is no sensor (Windows). The Pi 4 slows itself down from 80 °C."""
    try:
        return int(THERMAL.read_text().strip()) / 1000
    except (OSError, ValueError):
        return None


def memory() -> dict | None:
    """RAM in bytes. Used is what new programs could not get: the page cache counts as free, since it gives way."""
    try:
        kb = {}
        for line in MEMINFO.read_text().splitlines():
            name, _, rest = line.partition(":")
            if rest.split():
                kb[name] = int(rest.split()[0])
        total, available = kb["MemTotal"] * 1024, kb["MemAvailable"] * 1024
    except (OSError, ValueError, KeyError):
        return None
    return {"total": total, "used": total - available}


def cpu_times() -> tuple[int, int] | None:
    """(busy, total) CPU time since boot over all cores, in clock ticks; waiting for the disk counts as idle."""
    try:
        first = STAT.read_text().splitlines()[0]          # cpu  user nice system idle iowait irq softirq steal ...
        user, nice, system_, idle, iowait, irq, softirq, steal = map(int, first.split()[1:9])
    except (OSError, ValueError, IndexError):
        return None
    total = user + nice + system_ + idle + iowait + irq + softirq + steal
    return total - idle - iowait, total


_cpu_last: tuple[float, int, int] | None = None     # when, busy and total at the previous reading


def cpu_usage() -> float | None:
    """Share of the CPU in use (all cores together) since the last call, which is the page's polling
    interval; over half a second when there is no recent reading to compare with."""
    global _cpu_last
    now, times = time.time(), cpu_times()
    if times is None:
        return None
    if _cpu_last and 0.5 <= now - _cpu_last[0] <= 60:
        before = _cpu_last[1:]
    else:
        time.sleep(0.5)
        before, now, times = times, time.time(), cpu_times()
        if times is None:
            return None
    _cpu_last = (now, *times)
    busy, total = times[0] - before[0], times[1] - before[1]
    return round(busy / total, 3) if total > 0 else None


def uptime() -> float | None:
    """Seconds since the Pi booted; a short one after an unattended night means it rebooted by itself."""
    try:
        return float(UPTIME.read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def run(*cmd: str) -> str | None:
    """A quick read-only command's output, None when it is missing or fails (off the Pi)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def throttling() -> dict | None:
    """Under-voltage and slow-downs reported by the firmware, now and since boot. Under-voltage means the
    power supply or its cable sags under load; since-boot flags only clear with a reboot."""
    out = run("vcgencmd", "get_throttled")              # throttled=0x50000
    try:
        value = int(out.partition("=")[2], 16) if out else None
    except ValueError:
        value = None
    if value is None:
        return None
    return {"now": [name for bit, name in THROTTLE_BITS.items() if value >> bit & 1],
            "since_boot": [name for bit, name in THROTTLE_BITS.items() if value >> (bit + 16) & 1]}


def clock_synced() -> bool | None:
    """Whether the clock is set from the network. The Pi keeps no time while off, and a wrong clock
    puts every pass prediction at the wrong time."""
    return {"yes": True, "no": False}.get(run("timedatectl", "show", "--property=NTPSynchronized", "--value") or "")


def network() -> dict | None:
    """How the Pi is connected: Ethernet, and the Wi-Fi network with its signal (0-100 %)."""
    try:
        connected = {d["type"] for d in networks.devices() if d["connected"]}
        wifi = networks.wifi_link() if "wifi" in connected else None
    except (networks.NetworkError, ValueError):
        return None
    return {"ethernet": "ethernet" in connected, "wifi": wifi}


@router.get("")
def get_system() -> dict:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    disk = shutil.disk_usage(settings.DATA_DIR)
    cpu = cpu_usage()
    return {
        "hostname": socket.gethostname(),
        "version": git_version(),
        "data_dir": str(settings.DATA_DIR),
        "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
        "temperature": temperature(),
        "memory": memory(),
        "cpu": {"usage": cpu, "cores": os.cpu_count()} if cpu is not None else None,
        "uptime": uptime(),
        "throttling": throttling(),
        "clock_synced": clock_synced(),
        "network": network(),
    }


@router.post("/{action}")
def power(action: Literal["restart-app", "reboot", "poweroff"]) -> dict:
    """Restart the app, reboot or shut down the Pi (the danger zone in Settings). Needs passwordless sudo."""
    try:
        check = subprocess.run(["sudo", "-n", "true"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(409, f"sudo is not available: {e}")
    if check.returncode != 0:
        raise HTTPException(409, check.stderr.strip() or "this needs passwordless sudo")
    supervisor.note("warn", f"{action} requested from the web page")
    # a second's delay so this answer reaches the page before anything stops
    subprocess.Popen(["sh", "-c", f"sleep 1; exec sudo -n {POWER_COMMANDS[action]}"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"action": action}
