#!/usr/bin/env bash
# After `git pull`: refresh dependencies, rebuild the frontend, restart the service.
#   bash scripts/update.sh               normal use
#   bash scripts/update.sh --no-restart  used by install.sh before the service exists
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

if [ "${1:-}" != "--no-restart" ] && [ -f "/etc/systemd/system/$SERVICE.service" ]; then
  echo "== restart"
  sudo systemctl restart "$SERVICE"
fi
echo "== updated to $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo 'uncommitted code')"
