# raspberry_sat — automated Meteor ground station on a Pi 4

## Context

A roof-mounted Raspberry Pi 4 + RTL-SDR (V-dipole) should receive Meteor-M2-3/M2-4 LRPT unattended. raspberry-noaa-v2 was rejected: no web config, its UI isn't liked. Instead: **SatDump does the radio work** (its headless `satdump autotrack` mode schedules passes, tunes, decodes, optionally drives a rotctl rotator), and **our own app** wraps it: web config, live status, gallery, Discord posting, storage retention on a 64 GB card.

Repo `C:\code\raspberry_sat` (empty, remote `git@github.com:bonchan/raspberry_sat.git`). Monorepo, Python backend, pnpm + Vite + React + TS frontend. Coded on Windows, pushed, then `git pull` over SSH on the Pi; **the app runs straight from the checkout and is built on the Pi**. LAN only, no login.

### What SatDump 1.2.2 autotrack gives us (read from its source)
- Run: `satdump autotrack <config.json>`. Config keys: `output_folder`, `qth {lat,lon,alt}`, `tracked_objects [{norad, min_elevation, frequency, live, record, pipeline_name, pipeline_params}]`, `tracking {autotrack_cfg {autotrack_min_elevation, stop_sdr_when_idle, multi_mode}, rotator_cfg {address, port}, rotator_algo}`, `finish_processing` (must be true for Meteor images), `http_server "127.0.0.1:8081"`, `parameters {source:"rtlsdr", source_id?, samplerate, initial_frequency, gain, agc, bias, ppm_correction, fft_enable}`.
- Its HTTP server exposes `/api` (JSON status: next AOS/LOS, object, az/el, rotator), `/polarplot.jpeg`, `/schedule.jpeg`, `/fft.jpeg`. We proxy these.
- One folder per pass under `output_folder`; images are written after LOS by the finish-processing step.
- Pipelines: `meteor_m2-x_lrpt` (72k), `meteor_m2-x_lrpt_80k`. Release `satdump_1.2.2_arm64.deb` exists.
- It always tries to connect a rotctl rotator → can point straight at the Arduino rotator over WiFi (port 4533).
- Caveat: SatDump itself logs "CLI AutoTrack is still WIP". Fallback if it misbehaves: our backend computes passes (skyfield) and runs `satdump live <pipeline>` per pass. Not planned unless needed.

## Stack (my take on your choice)
Python + pnpm/Vite/React is a good fit. Specifics:
- **Backend:** Python 3.11 (Bookworm's), FastAPI + uvicorn, pydantic for the config model, a pass.json per pass folder as the pass index, httpx (Discord, SatDump proxy), Pillow (thumbnails, Discord-sized JPEGs). Lives in a venv inside the repo (`backend/.venv`, gitignored) — Bookworm blocks system-wide pip.
- **Frontend:** React + TS + Vite, React Router, plain CSS (dark, same feel as your rotator page). Built on the Pi into `frontend/dist`, served by FastAPI — one process, one port.
- **Node on the Pi:** Bookworm's apt Node 18 is too old for current Vite → install Node 22 LTS from NodeSource, pnpm via corepack.
- **OS:** Raspberry Pi OS Lite 64-bit **Bookworm** (matches the SatDump arm64 .deb).

## Layout
```
raspberry_sat/
  backend/
    pyproject.toml            deps + pytest config
    app/
      main.py                 FastAPI app, routers, serves frontend/dist, starts background tasks
      settings.py             paths (data dir from env RASPBERRY_SAT_DATA, default ~/raspberry_sat_data)
      config.py               pydantic Config model, load/save data/config.json, defaults
      satdump_cfg.py          Config -> autotrack.json (pure function, unit-tested)
      supervisor.py           start/stop/restart `satdump autotrack` child process, log ring buffer,
                              auto-restart with backoff, nightly restart when idle (fresh TLEs)
      passes.py               finish a pass when SatDump logs "Pipeline Processing Done!" (fallback: 5 min
                              without a new file): rename, thumbnails,
                              pass.json per pass instead of a SQLite index (metadata travels with the folder)
      discord.py              bot post (HTTP API): pass summary + one JPEG per composite, one message
      retention.py            delete passes older than N days / beyond max GB, oldest first; drop basebands
      tasks.py                asyncio loop: scan -> post -> retention every 30 s
      routers/                config, status (proxy to SatDump :8081), passes, images, logs, system (disk, restart)
    tests/                    pytest: config->autotrack.json, pass detection, retention, discord payload (mocked)
  frontend/
    package.json, vite.config.ts (dev proxy /api -> localhost:8000)
    src/pages/  Status, Passes (gallery), PassDetail, Settings, Logs
  scripts/
    install.sh                one-time on the Pi: apt deps, SatDump .deb, NodeSource Node 22 + pnpm,
                              venv + pip install, pnpm install + build, write + enable systemd unit
    update.sh                 after git pull: pip install, pnpm install + build, restart service
                              (later: hook into boot for pull-on-reboot)
    raspberry_sat.service     template, runs uvicorn from the checkout as the install user, port 8000
  README.md                   Pi setup from a blank card, dev on Windows
  .gitignore                  .venv, node_modules, dist, data
```

## Config (edited in the web UI, stored as data/config.json)
- **stations:** list of name, lat, lon, alt; one of them selected (`active_station`) and used by SatDump
- **sdr:** source (rtlsdr), device id, sample rate (1.024 MS/s), gain, agc, bias-tee, ppm
- **satellites:** list of {name, NORAD, frequency, pipeline, min elevation, enabled}; defaults Meteor-M2-3 (57166) and M2-4 (59051), 137.9 MHz, `meteor_m2-x_lrpt` — IDs/frequencies checked against current TLEs during build
- **tracking:** global min elevation, stop SDR when idle
- **rotator:** enabled, address, port (Arduino rotator: board IP, 4533)
- **discord:** mode (off / automatic / by hand), application ID, bot token, channel ID, which composites to post (empty = all), post empty/failed passes or not
- **storage:** keep days, max GB, keep baseband (default off)

Saving config regenerates autotrack.json and restarts SatDump (only when no pass is in progress, otherwise queued until LOS).

## Build order (each step deployable and testable on the Pi)
1. **Skeleton:** monorepo, FastAPI health + config load/save, React shell with Settings page, install/update scripts, systemd unit, README. Goal: `install.sh` on a fresh Pi → page at `http://pi:8000`.
2. **SatDump supervisor:** autotrack.json generation, process control, logs page, Status page (next pass, az/el, polar plot, schedule, FFT via proxy).
3. **Passes:** scanner + pass.json + thumbnails + gallery + pass detail.
4. **Discord:** bot posting, test-message button, posted state per pass.
5. **Retention:** cleanup job, disk usage on Status page.
6. **Rotator + polish:** rotator settings, show rotator position, small UX fixes.

## Later (ideas, not scheduled)
- **Globe view in Passes, further:** the Globe layout shows one day's passes (`PassesGlobe.tsx`); next could
  be several days at once, blending overlapping passes into a mosaic, or the image's night/day choice
  (MSA by day, MCIR at night).
- **Gain as a dropdown:** tuners only have fixed gain steps and SatDump rounds up to the next one. Ask the
  dongle for its steps (`rtlsdr_get_tuner_gains`, while SatDump has the SDR idle) and offer those instead of
  a free number; other SDR types have other gain controls. Notes at `Sdr.gain` in `backend/app/config.py`.
- **Gain per pass:** record the gain (and other receiver settings) in each pass's `pass.json` and show it in
  the gallery, to compare passes when tuning.
- **Pass quality thresholds as settings:** the good / excellent colours on Upcoming passes start at a fixed
  30° / 60° highest elevation (`GOOD` / `EXCELLENT` in `frontend/src/UpcomingPasses.tsx`). What counts as good
  depends on the antenna and what blocks the sky; once real results show it, move them to Display settings
  next to "show low passes".
- **Images of the whole pass:** SatDump only draws the lines it decoded, so a pass lost at the start or end
  gives a shorter image; it has no option to cover the whole pass. Three ways, none chosen yet:
  - pad the images ourselves from AOS to LOS, placing the received part by time (orbit in `pass.json`,
    sync per second in `signal.json`); approximate to a few lines, and passes still differ in length unless
    padded to a fixed maximum. Shows at a glance where passes get lost (antenna, obstructions);
  - `fill_missing` (SatDump 1.2.0+, Meteor LRPT pipeline parameter) blends short dropout gaps in the middle,
    up to `max_fill_lines` (default 50), and keeps the original too; could be a receiver setting;
  - a projection onto a fixed lat/lon box: same size and area every pass, for comparing weather or
    animations; parts of a pass outside the box are cut off.
- **Releases only:** an update channel that follows tags instead of every commit on `main`.
- **TODO: drop the old `rsat` names.** They were renamed to `RASPBERRY_SAT_*` / `raspberry-sat-*`, but the old
  ones are still read so Pis updating across the rename keep working. Once every Pi has updated once since
  (on the Pi, `systemctl cat raspberry_sat` shows `RASPBERRY_SAT_DATA`), remove the `RSAT_` fallback in
  `env()` in `backend/app/settings.py` and in `DATA_DIR` in `scripts/update.sh`, and `OLD_PREFIX` in
  `frontend/src/storage.ts` (browsers then forget choices saved under the old names, once).
- **Fallback hotspot with captive portal** when the Pi has no network (dropped for now; the phone-hotspot
  trick on the Networks page covers moving the Pi).

## Dev on Windows
- Backend runs without SatDump (supervisor reports "satdump not installed"); point `RASPBERRY_SAT_DATA` at a copy of a real pass folder to develop gallery/Discord.
- `pnpm dev` with Vite proxying `/api` to `uvicorn --reload` on :8000.

## Verification
- `pytest` in `backend/` (Windows and Pi): autotrack.json matches SatDump's expected shape, done-detection, retention picks the right folders, Discord payload sizes.
- `pnpm build` (type check + bundle) must pass.
- On the Pi per step: `install.sh` / `update.sh`, service up, page loads; step 2: SatDump schedule shows upcoming Meteor passes; steps 3–5: after a real pass, images appear in the gallery, one Discord message arrives, old test passes are pruned by a low keep-days setting.
