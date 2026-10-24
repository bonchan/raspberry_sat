# Sync passes to a central gallery (Cloudflare)

## Context

Several stations (each a Pi running this app, sometimes moved, sometimes on a phone hotspot) send their
passes to one website: an **image gallery** of all stations. Free, no server to run.

**Chosen:** a Cloudflare Worker with R2 (images, `.cadu` files), D1 (the database) and Access (login).

**Gallery first.** The Pi already decodes each pass and makes every image, so it sends only what the gallery
shows: a database row, a thumbnail and the main image. The `.cadu` goes along as an archive. All other images
are made only when asked for ("Get all images"), by the station that recorded the pass or by a script on the
PC. Thumbnails stay; large images expire.

Why the Pi keeps processing: the `.cadu` is ~7× larger than the main image and its thumbnail, and Cloudflare's
free plan cannot run SatDump (Workers run no native programs and get 10 ms of CPU per request; Containers
need the paid plan).

Not chosen (Oct 2026): Firebase (Storage needs the Blaze plan since 3 Feb 2026, and new buckets allow 5K
uploads a month), Supabase (1 GB, projects paused after 7 days idle), Oracle Always Free (card, idle VMs
reclaimed, capacity), a home server (needs an always-on machine). If the card for R2 becomes a problem: same
Worker and D1, files in Backblaze B2 (10 GB free, no card, free transfer to Cloudflare).

## Sizes (measured on data/passes)

A good pass is ~125–135 MB on the Pi: 19 PNGs (~120–130 MB), the `.cadu` (~3 MB), small JSON files. One
sample also has a 104 MB `.soft` file from saving the baseband; it is never sent.

| What | Good pass | Per station and month (8 passes/day) |
|---|---|---|
| Database row (pass.json without images' details, orbit track, signal summary, TLE) | ~10–20 KB | ~5 MB in D1 |
| Thumbnail of the main image (480 px, kept forever) | ~60 KB | ~14 MB |
| Main image (1600 px JPEG, expires) | ~0.4 MB | ~100 MB |
| `.cadu` (optional archive) | ~3 MB | ~750 MB |
| "Get all images": every image at 1600 px + thumbs (only when asked) | ~12 MB | — |

- Main image at full size instead (2800 px): ~1 MB.
- Short passes are much smaller (sample 002: 70 KB main image, 0.4 MB `.cadu`).
- Without the `.cadu` a pass sends ~0.5 MB: fine on a phone hotspot. With it, the `.cadu` waits for Wi-Fi by
  default.

R2's free 10 GB: images alone last for decades with one station. With the `.cadu`, ~1 year for one station,
~4 months for three; beyond that R2 costs ~$0.015 per GB and month (three stations' `.cadu` for a year,
~27 GB: ~$0.25 a month).

## Free tier limits that matter (checked 2026-10-20)

| Service | Free | Our use (3 stations, 8 passes/day each) |
|---|---|---|
| R2 | 10 GB-month, 1M writes (class A) and 10M reads (class B) a month, no transfer charges | ~2.6 GB a month with `.cadu`, ~0.35 GB without; ~3K writes a month |
| Workers | 100,000 requests a day, 10 ms CPU per request, 100 MB per request body; static files free and unlimited | ~2,300 a day from stations (heartbeats every 2 min), plus viewing |
| D1 | 5 GB, 5M rows read and 100K rows written a day | a few dozen rows written a day; reads kept low by caching |
| Access (Zero Trust) | Free for teams under 50 users | login for the website |

R2 needs an R2 subscription through Cloudflare's checkout, which asks for a payment method even for free use.

## Overview

```
Pi (each station)                                   Cloudflare, one Worker "rsat-hub"
  pass finished ─▶ hub.py ── HTTPS, Bearer <token> ─▶ /ingest/*  ──▶ R2  p/<station>/<pass>/...
  queue in pass.json["hub"], retries                  (Access: bypass)  D1  stations, passes, images, requests
  heartbeat every 2 min ◀── open "get all" requests ─┘

Browser ── Access login (email one-time PIN) ──▶ /api/*  gallery API, stations, requests
                                                 /*      the frontend built in hub mode
PC (when needed) ── pnpm --dir hub process ──▶ answers "get all" for passes no station can answer
```

## Adding a station (from the website)

Stations page → **Add station**: a short id (`roof`) and a name. The hub makes a token (32 random bytes,
stored only as its SHA-256) and shows the station's **hub link** once, with a copy button:

```
https://hub.example.com/ingest/roof/Xq3v...token...
```

Like a Discord webhook URL: one link holding the hub's address, the station's id and its token. On the Pi:
Settings → Hub → paste the link → **Test** (answers with the station's id and name) → switch on. The Pi splits
the link and sends the token as `Authorization: Bearer`, never in a URL.

Also on the Stations page: **New link** (new token, the old link stops working at once: for a lost or leaked
link, or a reinstalled Pi), **Revoke** (the station can no longer send; its passes stay), **Delete** (with or
without its passes). Each station shows its last heartbeat: where it is, last seen, app version, disk, queue,
next pass, last error.

Only admins see these buttons: the emails in the Worker variable `ADMIN_EMAILS` (empty: everyone Access lets
in, i.e. just you at first). The Worker takes the email from the Access token it verifies (see Login).

## What a station sends

Per pass, in one upload (see protocol):

| Where | What |
|---|---|
| D1 `passes` | pass.json without `hub` and `discord`, plus `station` and `tle` (below); `images` lists every image SatDump made (name, variants, size, coverage), so the gallery knows what "Get all" would bring |
| D1 `images` | one row per image on the hub: the main image at first |
| R2 `thumb/<image path>.jpg` | the main image's thumbnail, already in `.thumbs/` |
| R2 `large/<image path>.jpg` | the main image, `passes.large_version` (1600 px; setting: full size) |
| R2 `meteor_m2-x_lrpt.cadu` | when **Send the .cadu** is on (default), on an unmetered connection |

Not sent: the PNGs, `signal.json`, `product.cbor`, `dataset.json`, `telemetry.json`. The signal *summary*
(peak and mean SNR, lock, drops, seconds per 10° of elevation) is in pass.json, so it is in the row.

### pass.json: where and with which orbit

- `station`: today pass.json doesn't say which station received it (`orbits.py` uses whatever station is
  selected). Stations move, so `passes.finalize` writes `"station": {name, lat, lon, alt}` from
  `config.station`. Older passes get the current station when uploaded.
- `tle`: the TLE SatDump used, from `MSU-MR/product.cbor` (`cbor2` is already a dependency, for georef.py).
  Needed to make map overlays and projections again from the `.cadu` months later: a current TLE is off by
  kilometres for an old pass. Raw images don't depend on it.

## Station side (Python)

### Config

```python
class Hub(BaseModel):
    mode: Literal["off", "auto", "manual"] = "off"   # auto: each finished pass; manual: a button on the pass page
    link: str = ""                 # the hub link from the Stations page: address, station id, token
    full_size: bool = False        # main image at full size (~1 MB) instead of 1600 px (~0.4 MB)
    send_cadu: bool = True
    on_metered: Literal["light", "wait"] = "light"   # light: row, thumb, main image now; .cadu and "get all" later
    since: float = 0               # passes finished before this are only sent with "Send older passes"
```

Settings → Hub: the link, **Test**, mode, main image size, `.cadu`, metered connections. Switching it on sets
`since` to now, so a station with weeks of passes doesn't push them all over a hotspot; **Send older passes**
queues those too.

### hub.py

Built like `discord.py`: one upload at a time, the state in pass.json, errors noted and shown on the pass page.

- **State** in `pass.json["hub"]`: `{uploaded_at, files: {path: sha256}, cadu_at, error, failed_at, attempts, next_try}`.
- **Loop** in `tasks.py`, every 60 s: nothing while SatDump is receiving or within `passes.SETTLE` after LOS
  (as the scanner and the updater do). Otherwise one pass whose upload is missing or out of date (e.g.
  `add_orbits` filled its orbit later), newest first; then `.cadu` files still owed, when not metered.
- **Retries:** on failure `next_try = now + min(1 h, 1 min × 2^attempts)`; reset on success. A station offline
  for a week sends everything once back. The log notes the first failure per pass, not every try.
- **Metered:** NetworkManager marks Android hotspots metered by itself
  (`nmcli -t -f GENERAL.METERED device show <dev>` → `yes (guessed)`); other networks can be marked on the
  Networks page (`connection.metered yes`).
- **Renamed folders:** when `passes.repair` renames an uploaded pass, delete the old id on the hub; the new
  name uploads as a new pass.
- **Deleted on the Pi** (button or storage cleanup): stays on the hub; the `.cadu` there can rebuild it.
- No new Python dependencies: httpx, hashlib, cbor2.

### Upload protocol

All under `/ingest`, `Authorization: Bearer <token>`. The Worker finds the station from the token, so a
station only writes its own passes. Every step can be repeated safely.

1. `POST /ingest/passes/{pass_id}/begin` with `{files: [{path, sha256, bytes}]}` → `{missing: [path]}`.
2. `PUT /ingest/passes/{pass_id}/files/{path}` for each missing file, with `Content-Length` and `X-Sha256`. The
   Worker streams it to R2 with `put(key, body, {sha256})`, so R2 rejects a damaged upload. The largest file,
   the `.cadu`, is ~3 MB, far under the 100 MB request limit; streaming costs almost no CPU.
3. `POST /ingest/passes/{pass_id}/commit` with `{meta, summary, images}`: `meta` is the pass.json as above,
   `summary` is `passes.summary(meta)` (the Pi's own gallery row), `images` the image rows for the files sent.
   The pass appears in the gallery only now.

`DELETE /ingest/passes/{pass_id}` removes a pass (renames).

### Heartbeat and requests

`POST /ingest/heartbeat` every 2 minutes: app version, hostname, station position, disk, SatDump state, next
pass, last error, queue length. The answer lists open "get all" requests for this station's passes. 720
requests a day per station.

## Get all images

On a pass's page: **Get all images**. It adds a row to `requests` (state `queued`) and the page shows its
progress. The same button makes the images again after they expired.

1. **The station that recorded the pass** sees it in its next heartbeat answer and claims it (`claimed`).
   Not during a pass or shortly before one (the updater's `pass_soon` check).
   - Pass folder still on the Pi: a 1600 px JPEG and a thumb of every image (`passes.large_version`,
     `.thumbs/`), uploaded like a pass, then `done`.
   - Folder gone (storage cleanup): the station downloads its `.cadu` back
     (`GET /ingest/passes/{pass_id}/cadu`), runs SatDump on it in a temporary folder with the pass's TLE, makes
     the JPEGs and thumbs with the same code, uploads, deletes the temporary folder.
2. **The PC**, for requests no station claims within an hour (the station is offline, moved without Wi-Fi, or
   retired): `pnpm --dir hub process` lists them, downloads each `.cadu`, runs SatDump for Windows, makes
   JPEGs and thumbs (`sharp`), uploads them. It signs in with a processor token made on the Stations page,
   which may only answer claimed requests. Run it when wanted; nothing stays on.

A request without a `.cadu` on the hub and no station holding the folder fails with that reason.

**To test before building step 2 of this:** `satdump meteor_m2-x_lrpt cadu <file> <out>` on the Pi and on
Windows, and whether SatDump 1.2.2 can be given the pass's TLE (otherwise: a separate SatDump config folder
whose `satdump_tles.txt` holds it, with TLE updates off). Also how long a Pi 4 takes per pass.

## Hub side (TypeScript, `hub/`)

```
hub/
  package.json         wrangler, typescript, @cloudflare/workers-types, jose; sharp and tsx for the PC script
  wrangler.jsonc       R2 binding FILES, D1 binding DB, assets ../frontend/dist-hub, cron trigger, vars
  migrations/0001_init.sql
  src/index.ts         routing: /ingest/*, /api/*, everything else is the frontend
  src/ingest.ts        tokens, begin/files/commit/delete, heartbeat, cadu download
  src/gallery.ts       read API, requests
  src/stations.ts      add, new link, revoke, delete (admins)
  src/access.ts        checks the Access token, admin emails
  src/retention.ts     the daily cron job
  scripts/process.ts   the PC script for "get all"
```

Deployed from the Windows PC: `pnpm --dir frontend build:hub` then `pnpm --dir hub deploy` (`wrangler deploy`).
Nothing of it runs on the Pi. Static files: `assets` with `not_found_handling: "single-page-application"` and
`run_worker_first` for `/api/*` and `/ingest/*`.

### D1

```sql
CREATE TABLE stations (
  id         TEXT PRIMARY KEY,      -- short id given when added: "roof"
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'station',   -- 'station' | 'processor' (the PC script)
  token_hash TEXT NOT NULL,         -- SHA-256 of the token; the token is shown once
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen  INTEGER,
  heartbeat  TEXT                   -- the last heartbeat, JSON
);
CREATE TABLE passes (
  station     TEXT NOT NULL REFERENCES stations(id),
  id          TEXT NOT NULL,        -- the folder name on the Pi
  time        REAL NOT NULL,
  satellite   TEXT,
  lat REAL, lon REAL,               -- where the station was
  main        TEXT,                 -- path of the main image
  summary     TEXT NOT NULL,        -- PassSummary JSON as the station made it, plus station
  meta        TEXT NOT NULL,        -- the rest of pass.json: orbit, signal, images SatDump made, tle
  cadu_bytes  INTEGER,              -- null: no .cadu on the hub (yet)
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (station, id)
);
CREATE INDEX passes_time ON passes(time DESC);
CREATE INDEX passes_uploaded ON passes(uploaded_at);
CREATE TABLE images (
  station TEXT NOT NULL, pass TEXT NOT NULL, path TEXT NOT NULL,
  name TEXT, variants TEXT, width INTEGER, height INTEGER,
  large_bytes INTEGER,              -- null once the large JPEG expired; the thumb stays
  made_at INTEGER NOT NULL,         -- when the large JPEG was made, for expiry
  PRIMARY KEY (station, pass, path)
);
CREATE TABLE requests (
  id INTEGER PRIMARY KEY, station TEXT NOT NULL, pass TEXT NOT NULL,
  state TEXT NOT NULL,              -- queued | claimed | done | failed
  claimed_by TEXT, error TEXT, created_at INTEGER NOT NULL, done_at INTEGER
);
CREATE INDEX requests_open ON requests(station, state);
```

R2: `p/<station>/<pass>/thumb/<image path>.jpg`, `.../large/<image path>.jpg`, `.../meteor_m2-x_lrpt.cadu`.

Two stations can record the same pass under the same folder name; the key is (station, id), and the gallery
can show both side by side.

### Gallery API

The same paths and shapes as the Pi's where they exist, so the frontend changes little. On the hub a pass id
is `<station>~<folder name>` (`roof~2026-10-12_1310Z_meteor-m2-3`); the frontend already treats ids as opaque,
so `passFile()` and the routes stay as they are.

| Path | Answer |
|---|---|
| `GET /api/passes?since=` | `{passes: PassSummary[] with station, station_name; in_progress: []}`; the page asks for the last 90 days, "load older" for more |
| `GET /api/passes/{id}` | the row's meta; `images` marks which have a thumb and a large JPEG on the hub; `files: []`, `samples: []` |
| `GET /api/passes/{id}/thumb/{path}`, `/large/{path}` | from R2, `Cache-Control` as on the Pi; `large` falls back to the thumb once expired |
| `POST /api/passes/{id}/request` | Get all images; `GET` the same path for its state |
| `GET /api/stations` | stations and their last heartbeat; `POST`, `DELETE`, `/new-link`, `/revoke` for admins |

Keeping within the free limits:
- **The pass list:** the Pi's gallery polls every 15 s; reading every row each time would use up D1's 5M rows a
  day. The list is cached (Cache API) under the latest `uploaded_at`, read with one indexed row, and answered
  with `ETag` / 304. The hub page polls every 5 minutes.
- **CPU (10 ms):** the list is built by joining the stored `summary` strings, not by parsing and re-encoding.

### Login and privacy

- An Access application for the hub's hostname: **Allow** for the listed emails, login with an email one-time
  PIN (no Google or other account needed). A second Access application for the path `/ingest` with **Bypass**:
  stations use their tokens there.
- The Worker also checks the Access token (`Cf-Access-Jwt-Assertion`, verified with `jose` against the team's
  certs) on `/api`, so a mistake in the Access setup doesn't open the API, and takes the email for
  `ADMIN_EMAILS` from it.
- Hostname: a domain on Cloudflare is the simplest. Without one, Access can also protect the `workers.dev`
  address (to be confirmed when setting up).
- Not sent: Discord links, the Pi's settings, anything with tokens.
- If the gallery is made public later: the rows carry each station's exact position, and the sky track
  (azimuth/elevation over time) gives it away to a few km too. Round or hide them first.

### Retention

Daily cron trigger (`retention.ts`), Worker variables:
- `LARGE_DAYS` (default 90): large JPEGs older than this are deleted, `large_bytes` set to null. Thumbnails stay.
  "Get all images" makes them again, from the station's folder or the `.cadu`.
- `CADU_DAYS` (default 0 = keep): `.cadu` files older than this are deleted.
- `MAX_GB` (default 9): while the total is over it, the oldest large JPEGs go first, then the oldest `.cadu`
  files; the Stations page says so. Raising it above 10 means paying for R2 by the GB, cents a month.
- A run handles a few dozen passes (10 ms CPU on the free plan too); the rest wait for the next day.

## Frontend in hub mode

The same `frontend/`, built with `vite build --mode hub --outDir dist-hub` (`.env.hub`: `VITE_HUB=1`, script
`build:hub`). `pnpm build` for the Pi stays as it is.

- **Routes** (`main.tsx`): Passes (start page), PassDetail, Stations. No Upcoming, Status, Live, Settings, Logs,
  Networks.
- **Layout:** no update or SatDump badges (no `/api/update`, `/api/status`); the language is kept in the browser
  only (no `/api/config`).
- **Passes:** the grid grouped by day as on the Pi, a station filter, the station's name on each card. The
  globe layout is left out for now.
- **PassDetail:** the main image (the thumb once expired), the pass's facts, the thumbs of every image on the
  hub, **Get all images** with its state; no Delete, no Discord, no originals.
- **Stations:** the station list with heartbeats; Add station, New link, Revoke, Delete for admins; the hub
  link shown once with a copy button.
- **Polling:** every 5 minutes instead of 15 s.

## Build order

1. **Station basics:** `station` and `tle` in pass.json; the upload set (row, thumb, main image, `.cadu`) with
   pytest on the Pi.
2. **Hub skeleton:** `hub/`, D1 migration, R2 bucket, `/ingest` (hello, begin, files, commit, delete), Stations
   API; deploy, add a station with curl.
3. **Uploader:** `Hub` config, Settings section with the link and Test, the loop with backoff, metered
   connections, a "Send to hub" button on the pass page.
4. **Gallery:** the gallery API, the hub build (Passes, PassDetail, Stations with Add station), Access in front.
5. **Get all images:** requests, heartbeat answers, the station answering from its folder; then from the
   `.cadu` (after the SatDump test above).
6. **PC script** for requests no station answers.
7. **Retention cron, "Send older passes".**

## Setting it up (once)

1. Cloudflare account. Optional: a domain on it, e.g. `hub.<domain>`.
2. R2 → subscribe (asks for a payment method), create bucket `rsat-files`. `wrangler d1 create rsat`,
   `wrangler d1 migrations apply rsat --remote`.
3. Zero Trust → pick a team name, Free plan. Access applications as in Login and privacy.
4. `pnpm --dir frontend build:hub && pnpm --dir hub deploy`; set `ADMIN_EMAILS`.
5. Per station: Stations → Add station, copy the hub link, paste it in the Pi's Settings → Hub, Test.

## Later (ideas, not scheduled)

- Statistics on the hub: the rows already carry the Pi's `PassSummary`, so `Statistics.tsx` could come along.
- The globe: needs the raw main composite and its lat/lon grid (`georef.py` on the Pi, as `geo.json`).
- The same pass from two stations: one view with both.
- Outgoing webhooks from the hub (Discord, others) when a pass arrives, instead of each Pi posting.
- Any station answering "get all" for retired stations, instead of the PC.
- A public gallery (see privacy).

## Verification

- `pytest` on the Pi: the upload set (main image picked, `station` and `tle` added, `hub`/`discord` left out,
  hashes), the hub link parsed, retry timing, metered handling (mocked nmcli), "get all" from the folder and
  from a `.cadu`, against a mocked hub.
- `pnpm build` and `pnpm build:hub` in `frontend/`; `tsc` and `wrangler deploy --dry-run` in `hub/`.
- On the hub: Add station, Test from the Pi, repeat the upload steps (nothing duplicated), a wrong or revoked
  token (401), New link (the old one gets 401).
- With a real station: a pass shows a minute after it is finished; Wi-Fi off for a few passes, then on: the
  queue sends them, newest first; on the hotspot the `.cadu` waits for Wi-Fi; Get all images with the folder on
  the Pi, then again after deleting it there (from the `.cadu`), then with the Pi off (the PC script).

## Sources (free tiers, checked 2026-10-20)

- R2: <https://developers.cloudflare.com/r2/pricing/>, <https://developers.cloudflare.com/r2/get-started/>
- Workers: <https://developers.cloudflare.com/workers/platform/pricing/>, <https://developers.cloudflare.com/workers/platform/limits/>
- D1: <https://developers.cloudflare.com/d1/platform/pricing/>
- Access: <https://www.cloudflare.com/sase/products/access/>
- Firebase: <https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024>, <https://firebase.google.com/pricing>
- Supabase: <https://supabase.com/pricing>
- Oracle: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- Backblaze B2: <https://www.backblaze.com/cloud-storage/pricing>
