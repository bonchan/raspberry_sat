import shutil
import socket
import subprocess

from fastapi import APIRouter

from app import settings

router = APIRouter(prefix="/system", tags=["system"])


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
