import shutil
import socket
import subprocess
from typing import Literal

from fastapi import APIRouter, HTTPException

from app import settings
from app.supervisor import supervisor

router = APIRouter(prefix="/system", tags=["system"])

SERVICE = "raspberry_sat"

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


@router.get("")
def get_system() -> dict:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    disk = shutil.disk_usage(settings.DATA_DIR)
    return {
        "hostname": socket.gethostname(),
        "version": git_version(),
        "data_dir": str(settings.DATA_DIR),
        "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
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
