#!/usr/bin/env bash
# After `git pull`: refresh dependencies, rebuild the frontend, refresh the service, restart it.
#   bash scripts/update.sh               normal use
#   bash scripts/update.sh --no-restart  used by install.sh, which starts the service itself
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# RSAT_DATA: the older name, still read (an update started by an app from before the rename passes it)
DATA_DIR="${RASPBERRY_SAT_DATA:-${RSAT_DATA:-$HOME/raspberry_sat_data}}"
SERVICE=raspberry_sat

echo "== backend"
cd "$REPO_DIR/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo "== frontend"
cd "$REPO_DIR/frontend"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0   # let corepack fetch pnpm without asking
pnpm install --frozen-lockfile
pnpm build

echo "== systemd service"
mkdir -p "$DATA_DIR"
sed -e "s|@USER@|$USER|g" -e "s|@REPO@|$REPO_DIR|g" -e "s|@DATA@|$DATA_DIR|g" \
  "$REPO_DIR/scripts/$SERVICE.service" | sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null
sudo systemctl daemon-reload

if [ "${1:-}" != "--no-restart" ]; then
  echo "== restart"
  sudo systemctl restart "$SERVICE"
fi
echo "== updated to $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo 'uncommitted code')"
