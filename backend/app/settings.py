"""Where things live. Read through the module (settings.CONFIG_FILE) so tests can point it elsewhere."""

import os
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_DIR / "frontend" / "dist"

# runtime data stays outside the checkout so a fresh clone or `git clean` never touches it
DATA_DIR = Path(os.environ.get("RSAT_DATA", Path.home() / "raspberry_sat_data"))
CONFIG_FILE = DATA_DIR / "config.json"
SATDUMP_DIR = DATA_DIR / "satdump"      # autotrack.json; also SatDump's working directory
PASSES_DIR = DATA_DIR / "passes"        # SatDump's output folder: one folder per pass
LOGS_DIR = DATA_DIR / "logs"

SATDUMP_BIN = os.environ.get("RSAT_SATDUMP", "satdump")
# SatDump keeps its downloaded orbit data here (refreshed when it starts, at most daily)
SATDUMP_TLES = Path(os.environ.get("RSAT_TLES", Path.home() / ".config" / "satdump" / "satdump_tles.txt"))
SATDUMP_HTTP = "127.0.0.1:8081"         # SatDump's own status server, reached only through our API
