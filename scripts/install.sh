#!/usr/bin/env bash
# One-time setup on Raspberry Pi OS Lite 64-bit (Bookworm). Run from the checkout as your normal user:
#   bash scripts/install.sh
# Safe to run again. For later code updates use scripts/update.sh.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SATDUMP_VERSION=1.2.2
NODE_MAJOR=22
SERVICE=raspberry_sat

echo "== apt packages"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates python3-venv python3-pip rtl-sdr

echo "== RTL-SDR: keep the TV driver off the dongle"
echo 'blacklist dvb_usb_rtl28xxu' | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf >/dev/null
sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true

echo "== SatDump $SATDUMP_VERSION"
if ! command -v satdump >/dev/null; then
  tmp="$(mktemp -d)"
  curl -fL -o "$tmp/satdump.deb" \
    "https://github.com/SatDump/SatDump/releases/download/$SATDUMP_VERSION/satdump_${SATDUMP_VERSION}_arm64.deb"
  sudo apt-get install -y "$tmp/satdump.deb"
  rm -rf "$tmp"
else
  echo "already installed: $(command -v satdump)"
fi

echo "== RTL-SDR driver from RTL-SDR Blog"
# Debian's librtlsdr is too old for the RTL-SDR Blog V4 (R828D tuner: weak or no reception); the Blog
# fork handles it and older dongles alike. It goes into /usr/local, and /usr/local/lib is put first for
# the dynamic linker so SatDump loads it. Debian's package stays: SatDump's package depends on it.
if [ ! -e /usr/local/lib/librtlsdr.so.0 ]; then
  sudo apt-get install -y libusb-1.0-0-dev cmake pkg-config build-essential
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/rtlsdrblog/rtl-sdr-blog "$tmp/rtl-sdr-blog"
  cmake -S "$tmp/rtl-sdr-blog" -B "$tmp/build" -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON
  make -C "$tmp/build" -j4
  sudo make -C "$tmp/build" install
  rm -rf "$tmp"
else
  echo "already installed: /usr/local/lib/librtlsdr.so.0"
fi
echo /usr/local/lib | sudo tee /etc/ld.so.conf.d/00-rtlsdr-blog.conf >/dev/null
sudo ldconfig
echo "SatDump uses: $(ldd /usr/lib/satdump/plugins/librtlsdr_sdr_support.so | grep -o '/[^ ]*librtlsdr[^ ]*' || echo 'not found')"

echo "== Node $NODE_MAJOR + pnpm"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable          # provides pnpm, version pinned in frontend/package.json

echo "== app dependencies, frontend build, service file"
bash "$REPO_DIR/scripts/update.sh" --no-restart

echo "== start the service"
sudo systemctl enable "$SERVICE"
sudo systemctl restart "$SERVICE"

echo
echo "Done. Open http://$(hostname).local:8000 (or http://$(hostname -I | awk '{print $1}'):8000)"
echo "Logs: journalctl -u $SERVICE -f"
echo "If the RTL-SDR was plugged in before this ran, unplug and replug it (or reboot)."
