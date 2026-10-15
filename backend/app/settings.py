"""Where things live. Read through the module (settings.CONFIG_FILE) so tests can point it elsewhere."""

import os
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_DIR / "frontend" / "dist"

# runtime data stays outside the checkout so a fresh clone or `git clean` never touches it
DATA_DIR = Path(os.environ.get("RSAT_DATA", Path.home() / "raspberry_sat_data"))
CONFIG_FILE = DATA_DIR / "config.json"
