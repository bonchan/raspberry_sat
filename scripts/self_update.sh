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
before="$(git rev-parse HEAD)"
git pull --ff-only

# Files the Pi doesn't use: the central gallery, notes, the rotator's sketches (the same list as
# NOT_ON_PI in backend/app/updater.py). When only those changed, there is nothing to rebuild or restart.
# --no-renames: a file moved out of the Pi's folders shows up as deleted there.
changed="$(git diff --name-only --no-renames "$before" HEAD)"
for_pi="$(printf '%s\n' "$changed" | grep -vE '^(hub/|docs/|arduino/)|^README\.md$' || true)"
if [ -z "$for_pi" ]; then
  echo "== no rebuild: nothing the Pi uses changed (only hub/, docs/, arduino/, README.md)"
  echo "== done"
  exit 0
fi

bash scripts/update.sh
echo "== done"
