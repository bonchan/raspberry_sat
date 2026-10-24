# Sync passes to a central gallery

## Context

Several stations (each a Pi running this app, sometimes moved, sometimes on a phone hotspot) send their
passes to one website, an **image gallery** of all stations, behind a Google sign-in. Free, no server to run.

## Decisions (2026-10-24)

1. **The hub lives in this repo**, in `hub/`, and Cloudflare deploys it from GitHub on each push
   (Workers Builds). Pushing is the whole update; no Update page on the hub.
2. **One Worker**, `raspberry-sat-hub`, at `https://raspberry-sat-hub.<subdomain>.workers.dev`: the gallery
   at `/`, its API under `/api` and `/auth`, and what stations upload to under `/ingest`.
3. **Storage:** R2 for the images, D1 for everything else (the Worker creates its tables itself).
4. **Sign-in with Google, done by the hub itself** (not Cloudflare Access, which would also lock out the
   stations). The first person to sign in becomes admin. Everyone after waits as *pending* until an admin
   makes them *viewer* or *admin* on the Users page.
5. **Stations are added on the hub** (Stations page): each gets the upload URL and its own token, pasted into
   the Pi's Settings → Destinations.
6. **Not tied to Cloudflare:** a destination is a URL + token speaking the small protocol below; any website
   that follows it works. The Pi keeps a **list** of destinations.
7. **What a pass sends:** pass.json, and for each chosen image a large JPEG and a thumbnail. The images are
   chosen like Discord's "Images to post" (empty: one per composite, main image first). No `.cadu` for now.
8. **On the Pi, per destination:** off / automatic / by hand, and optionally **delete from the Pi once
   uploaded**, keeping only the main image; the pass page then links to the hub.

Not chosen: Firebase (Storage needs the Blaze plan since 3 Feb 2026, 5K uploads a month on new buckets),
Supabase (1 GB, projects paused after 7 idle days), Oracle Always Free (card, idle VMs reclaimed), a home
server (always-on machine), sending whole passes (~130 MB each: R2's free 10 GB would last ~10 days), or the
`.cadu` for the hub to process (Workers can't run SatDump; the Pi already made the images).

## Sizes (measured on data/passes, good pass)

| What | Size | Per station and month (8 passes/day) |
|---|---|---|
| Thumbnail (480 px) | ~60 KB per image | |
| Large JPEG (1600 px) | ~0.4 MB per image (full size: ~1 MB) | |
| One image per composite (6) + thumbs + pass.json | ~3.4 MB | ~0.8 GB |
| Main image only + thumb + pass.json | ~0.5 MB | ~0.1 GB |
| Whole pass folder, for comparison | ~130 MB | ~31 GB |

R2's free 10 GB: about a year for one station sending one image per composite, decades with the main image
only. Beyond that ~$0.015 per GB and month.

## Free tier limits that matter (checked 2026-10-20)

| Service | Free | Use |
|---|---|---|
| R2 | 10 GB-month, 1M writes and 10M reads a month, no transfer charges | needs a payment method on file (R2 subscription) |
| Workers | 100,000 requests a day, 10 ms CPU per request, 100 MB per request body; static files free | uploads stream to R2 (almost no CPU); one image shown = one request |
| D1 | 5 GB, 5M rows read and 100K written a day | a page of the gallery reads ~60 passes and their image counts |
| Workers Builds | 3,000 build minutes a month | one build per push touching `hub/` or `frontend/` |

## Protocol 1 (station → destination)

The destination URL is the base, e.g. `https://raspberry-sat-hub.<subdomain>.workers.dev/ingest`. Every
request carries `Authorization: Bearer <token>`. Errors answer `{"error": "..."}` with a status: 401 for an
unknown or revoked token, 400 with what is wrong.

| Request | Body | Answer |
|---|---|---|
| `GET {url}/hello` | | `{"station": {"id", "name"}, "protocol": 1}` (the Test button) |
| `PUT {url}/passes/{pass}/files/thumb/{image}.jpg` | the thumbnail, JPEG, with `Content-Length` (≤ 25 MB) | `{"stored": ...}` |
| `PUT {url}/passes/{pass}/files/large/{image}.jpg` | the image to show, JPEG | `{"stored": ...}` |
| `POST {url}/passes/{pass}` | `{"pass": <pass.json>, "images": [<image path>, ...]}` | `{"id", "url"}`: the pass's id and page on the hub |
| `DELETE {url}/passes/{pass}` | | `{"deleted": ...}` |

- `{pass}` is the pass's folder name (`2026-10-12_1310Z_meteor-m2-3`), `{image}` the image's path in it as in
  pass.json (`MSU-MR/msu_mr_rgb_MCIR_corrected.png`); each path part URL-encoded.
- Order: the files, then the `POST`, which fails with the list of missing files if any image lacks one. The
  pass shows only after the `POST`.
- Everything can be repeated: a pass sent again replaces the one before (and images left out are removed).
- `pass.json` is sent as the Pi has it, plus `station` (below), minus `discord` and `hubs`.

## The hub (`hub/`, built)

```
hub/
  wrangler.jsonc        Worker raspberry-sat-hub: D1 "raspberry-sat" (DB), R2 "raspberry-sat-files" (FILES), assets dist/
  src/                  the Worker
    index.ts            routing; same-origin check for changes from the pages
    schema.ts           the tables, created and updated by the Worker itself
    auth.ts             Google sign-in, sessions (30 days), roles
    gallery.ts          passes, one pass, image files (viewers and admins)
    stations.ts         add, new token, revoke, delete (admins)
    users.ts            roles, remove (admins; always at least one admin)
    ingest.ts           protocol 1 (stations)
  web/                  the pages (React), built into dist/; share frontend/src/styles.css with the Pi app
    src/pages/          Passes, PassDetail, Stations, Users
  CLOUDFLARE_SETUP.md   personal setup checklist, not in git
```

- **Tables:** `users` (Google id, email, role), `sessions` (hashed cookie), `stations` (hashed token,
  revoked, last heard from), `passes` (station, folder name, time, satellite, main image, coverage, highest
  elevation, peak SNR, the pass.json), `images` (per pass: path, name, variants, size).
- **R2:** `passes/<station>/<pass>/thumb/<image>.jpg` and `.../large/<image>.jpg`.
- **Pass ids** on the hub: `<station>~<folder name>`, so two stations recording the same pass don't collide.
- **Pages:** Passes (grid by day, station filter, older passes page by page), a pass (its images, facts,
  delete for admins), Stations (admins: add with URL + token shown once, new token, revoke, delete with its
  passes), Users (admins: roles, remove). Signed out: "Sign in with Google". Pending: "an admin has to let
  you in".
- **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Worker → Settings → Variables and Secrets).
  `NEW_USER_ROLE` in wrangler.jsonc: `pending` (default) or `viewer`.
- English only for now.

## Station side (to build next)

### pass.json: where it was received

Today pass.json doesn't say which station received it (`orbits.py` uses whatever station is selected).
Stations move, so `passes.finalize` writes `"station": {name, lat, lon, alt}` from `config.station`; older
passes get the current station when they are uploaded.

### Config

```python
class Destination(BaseModel):
    name: str = "hub"                  # unique; shown on the pass page ("On hub")
    url: str = ""                      # from the hub's Stations page
    token: str = ""
    mode: Literal["off", "auto", "manual"] = "off"   # auto: each finished pass; manual: a button on the pass page
    images: list[str] = []             # same syntax as discord.composites; empty = one per composite, main first
    full_size: bool = False            # large JPEG at full size (~1 MB) instead of 1600 px (~0.4 MB)
    delete_after_upload: bool = False  # once on this destination, keep only the main image on the Pi
    since: float = 0                   # passes finished before this only go with "Send older passes"

class Config(BaseModel):
    ...
    destinations: list[Destination] = []
```

Settings → Destinations: a list like the stations list; per destination URL, token, **Test** (`hello`), mode,
images, full size, delete after upload. Turning one on sets `since` to now, so a station with weeks of passes
doesn't push them all over a hotspot; **Send older passes** queues those too.

### Uploader (`backend/app/destinations.py`)

Built like `discord.py`, one upload at a time, the state in pass.json:
- `pass.json["hubs"][<name>]`: `{id, url, uploaded_at, error, failed_at, attempts, next_try}`.
- Picking images: `discord.pick_images` with the destination's list. Files: `.thumbs/<image>.jpg` (exists)
  and `passes.large_version` (1600 px) or a full-size JPEG.
- Loop in `tasks.py`, every 60 s: nothing while SatDump is receiving or within `passes.SETTLE` after LOS.
  Otherwise one pass per automatic destination that is not uploaded, or whose pass.json changed since
  (`add_orbits` filling the orbit later); newest first, so today's passes come before a backlog.
- Retries: `next_try = now + min(1 h, 1 min × 2^attempts)`, reset on success; the log notes the first failure
  of a pass, not every try. A station offline for a week catches up by itself.
- Automatic order after a pass: Discord (if on), then destinations, then deleting (below), so Discord still
  has every image.
- `passes.repair` renaming an uploaded pass: `DELETE` the old name on each destination, upload the new.
- No new Python dependencies (httpx).

### Delete after upload

When a destination with `delete_after_upload` confirms a pass (`POST` answered), the Pi keeps the main image
(PNG), pass.json, signal.json and `.thumbs/`, and deletes the other images, the `.cadu` and SatDump's other
files. pass.json notes it (`"slimmed": {"at", "destination", "url"}`). The pass page shows the thumbnails of
the deleted images and a link to the pass on the hub; the gallery marks the pass as on the hub. This cannot
be undone: the originals are gone, the hub has its JPEGs.

## Later (ideas, not scheduled)

- Heartbeat from stations (version, disk, next pass, last error) and a status column on the Stations page.
- Statistics and the globe on the hub (the globe needs the raw main composite and `geo.json` from the Pi).
- Retention on the hub (drop large JPEGs after N days, keep thumbnails).
- The `.cadu` as an archive, and "get all images" for a pass.
- The same pass from two stations side by side; a public gallery (round station positions first).
- Spanish on the hub.

## Verification

- `pnpm build` in `hub/` (type check of Worker and pages, bundle) and in `frontend/`.
- After the first deploy: sign in (you become admin), a second Google account waits as pending, make it
  viewer; add a station, `curl` the protocol with its token (hello, two PUTs, POST: the pass shows; a POST
  before the files: 400 with the list; a revoked token: 401).
- Station side: pytest on the Pi (picking, retries, delete after upload against a mocked destination); then a
  real pass: on the hub a minute after it is finished; Wi-Fi off for a few passes, then on: they catch up.

## Sources (free tiers, checked 2026-10-20 and 2026-10-24)

- R2: <https://developers.cloudflare.com/r2/pricing/>, <https://developers.cloudflare.com/r2/get-started/>
- Workers: <https://developers.cloudflare.com/workers/platform/pricing/>, <https://developers.cloudflare.com/workers/platform/limits/>
- D1: <https://developers.cloudflare.com/d1/platform/pricing/>
- Workers Builds: <https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/>, <https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/>
- Firebase: <https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024>
- Supabase: <https://supabase.com/pricing>
- Oracle: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
