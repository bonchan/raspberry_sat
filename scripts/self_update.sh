#!/usr/bin/env bash
# Run by the Update button on the web page, as its own systemd unit (raspberry_sat-update), so that
# update.sh restarting the app's service does not cut it short: pull, then the normal update.
#   bash scripts/self_update.sh <log file>
set -euo pipefail
exec >>"$1" 2>&1
trap 'echo "== FAILED (exit code $?)"' ERR

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "== git pull"
git pull --ff-only
bash scripts/update.sh
echo "== done"
