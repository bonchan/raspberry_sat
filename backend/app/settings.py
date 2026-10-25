"""Where things live. Read through the module (settings.CONFIG_FILE) so tests can point it elsewhere."""

import os
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_DIR / "frontend" / "dist"


def env(name: str, default):
    """The environment variable RASPBERRY_SAT_<name>, or its older short name RSAT_<name> (still read, e.g. by
    a service file written before the rename, until the next update rewrites it)."""
    return os.environ.get(f"RASPBERRY_SAT_{name}") or os.environ.get(f"RSAT_{name}") or default


# runtime data stays outside the checkout so a fresh clone or `git clean` never touches it
DATA_DIR = Path(env("DATA", Path.home() / "raspberry_sat_data"))
CONFIG_FILE = DATA_DIR / "config.json"
SATDUMP_DIR = DATA_DIR / "satdump"      # autotrack.json; also SatDump's working directory
PASSES_DIR = DATA_DIR / "passes"        # SatDump's output folder: one folder per pass
LOGS_DIR = DATA_DIR / "logs"

SATDUMP_BIN = env("SATDUMP", "satdump")
# SatDump keeps its downloaded orbit data here (refreshed when it starts, at most daily)
SATDUMP_TLES = Path(env("TLES", Path.home() / ".config" / "satdump" / "satdump_tles.txt"))
SATDUMP_HTTP = "127.0.0.1:8081"         # SatDump's own status server, reached only through our API
