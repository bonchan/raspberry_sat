# raspberry_sat

Unattended Meteor-M LRPT ground station on a Raspberry Pi 4 with an RTL-SDR.
[SatDump](https://github.com/SatDump/SatDump) does the radio work (pass scheduling, tuning, decoding,
optional rotator); this app wraps it with a web page for settings, live status, a gallery,
Discord posting and storage cleanup. LAN only, no login.

The plan and build order are in [docs/PLAN.md](docs/PLAN.md). Built so far:

1. Skeleton: settings page, config API, install scripts.
2. SatDump runs as `satdump autotrack` under the backend: generated config, start/stop/restart,
   restart after a crash, restart after a settings change (waits for a running pass), daily restart
   for fresh orbit data. Status page (next pass, polar plot, schedule, spectrum) and Logs page.
3. Passes: 5 minutes after SatDump stops writing a pass folder, the app finishes it: renames it to
   `<UTC start>_<satellite>` (e.g. `2026-10-12_1310Z_meteor-m2-3`), makes thumbnails in `.thumbs/`,
   picks a main image (MCIR corrected; the next choice if it is black) and measures how much of it
   was received, then writes `pass.json`. Passes page (gallery) and a page per pass with every
   composite, its variants, full-size originals and SatDump's files.
   Also: upcoming passes for the next 24 h computed with Skyfield from SatDump's own TLEs (sky plot
   and table on Status), a Live page during passes (progress, sky position, SNR, Viterbi/deframer
   lock, Reed-Solomon, frames, signal chart over the pass, spectrum), and a UTC clock in the header.

To try the gallery with passes made elsewhere (e.g. with the SatDump GUI), copy the pass folders
into `~/raspberry_sat_data/passes/` on the Pi; they are picked up 5 minutes later:

```bash
scp -r "data/passes/20261012 meteor m2-3 001" bon@rpi4b.local:raspberry_sat_data/passes/
```

## Layout

| Path | What |
|---|---|
| `backend/` | Python, FastAPI. Serves `/api` and the built frontend on port 8000 |
| `frontend/` | React + TypeScript + Vite, built into `frontend/dist` |
| `scripts/` | `install.sh` (once per Pi), `update.sh` (after each pull), systemd unit template |
| `docs/` | Plan and notes |

Runtime data (config, passes) lives outside the checkout in `~/raspberry_sat_data`
(override with the `RSAT_DATA` environment variable).

## Setting up the Pi

1. Flash **Raspberry Pi OS Lite (64-bit), Bookworm** with Raspberry Pi Imager. Bookworm is under
   "Raspberry Pi OS (other)". In Imager's settings set a hostname (e.g. `sat`), your user, WiFi if needed,
   and enable SSH.
2. Boot, then from your PC:
   ```bash
   ssh <user>@sat.local
   git clone https://github.com/bonchan/raspberry_sat.git
   cd raspberry_sat
   bash scripts/install.sh
   ```
   It installs SatDump 1.2.2, Node 22 + pnpm, the Python venv, builds the frontend and starts the
   `raspberry_sat` service. Takes a while on a Pi 4.
3. Open `http://sat.local:8000`, go to Settings and enter your station position.

## Updating

```bash
cd ~/raspberry_sat && git pull && bash scripts/update.sh
```

This also refreshes the systemd service file, so changes to it arrive with a normal pull.

Or from the web page: the header shows "Update available" when `origin/main` has new commits
(checked every 6 hours, or with "Check for updates" on the Update page). The Update page lists
the new commits with their messages and changed files; **Update now** runs `git pull` and
`update.sh` as a separate systemd unit (`raspberry_sat-update`; `journalctl -u raspberry_sat-update`)
so restarting the app does not interrupt it. It refuses while a pass is being received or decoded,
when the checkout has local changes, or when the Pi has commits of its own. It needs passwordless
sudo for the app's user, which Raspberry Pi OS gives the first user.

Logs: the Logs page, `~/raspberry_sat_data/logs/satdump.log` for SatDump's full output, and
`journalctl -u raspberry_sat -f` for the app itself.

Tests on the Pi:

```bash
cd ~/raspberry_sat/backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

## Developing on Windows

Frontend against the Pi's backend (no Python needed on the PC):

```bash
cd frontend
pnpm install
```

Create `frontend/.env.local` with `API_TARGET=http://sat.local:8000`, then:

```bash
pnpm dev
```

Backend locally (needs Python 3.11+):

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\pytest
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Without `API_TARGET`, `pnpm dev` talks to that local backend.
