"""Sending passes to websites that collect them from several stations, such as the raspberry-sat hub
(hub/ in this repo; any site that speaks the same protocol works). Protocol 1, docs/SYNC_PLAN.md: with
"Authorization: Bearer <token>", PUT each image's thumbnail and large JPEG, then POST the pass.json; the
answer is the pass's id and page there, and which receiver this Pi is there (the hub's id for it).

One upload at a time. Where a pass went (and to which receiver), or why the last try failed and when the
next is, goes into its pass.json under "hubs", one entry per destination name. A pass noted as sent to
another receiver than the token is now (the Pi added to the hub again) goes again. A destination set to
delete after upload leaves only the main image (and the pass's data and thumbnails) on the Pi once the
pass is there.
"""

import asyncio
import hashlib
import io
import json
import time
from pathlib import Path
from urllib.parse import quote

import httpx
from PIL import Image

from app import discord, passes
from app.config import Config, Destination, station_id

STATE = "hubs"                  # key in pass.json
LOCAL_KEYS = ("id", "discord", STATE, "slimmed")    # this Pi's own notes, not sent
MAX_IMAGES = 50                 # what the hub takes per pass
FULL_QUALITY = 85
RETRY_FIRST = 60                # seconds before trying again, doubling after each failure up to RETRY_MAX
RETRY_MAX = 3600
DISCORD_WAIT = 3600             # a pass this fresh isn't slimmed before Discord has posted it
USER_AGENT = "raspberry_sat (https://github.com/bonchan/raspberry_sat)"

transport: httpx.AsyncBaseTransport | None = None   # tests put a mock here
_sending = asyncio.Lock()       # one upload at a time; each rewrites pass.json
# destinations that are down or refuse this station: name -> (next try, failures in a row)
_down: dict[str, tuple[float, int]] = {}
# which receiver a token is on its destination (the hub's id for this Pi), learned from its answers. A pass
# noted as sent to another receiver (the Pi added to the hub again, a new token for another one) goes again.
_receivers: dict[str, str] = {}


class DestinationError(Exception):
    """The destination refused the pass or could not be reached; the text says why. `whole`: the
    destination as a whole (unreachable, wrong token, server error), not just this pass."""

    def __init__(self, message: str, whole: bool = True):
        super().__init__(message)
        self.whole = whole


def retry_delay(failures: int) -> float:
    return min(RETRY_MAX, RETRY_FIRST * 2 ** max(0, failures - 1))


# ---------- what goes ----------

def notes(meta: dict) -> dict:
    """{destination name: its note} from pass.json."""
    value = meta.get(STATE)
    return value if isinstance(value, dict) else {}


def outgoing(meta: dict, config: Config) -> dict:
    """pass.json as sent: without this Pi's own notes, with the station that received it (a pass from before
    pass.json recorded it gets the station selected now)."""
    out = {k: v for k, v in meta.items() if k not in LOCAL_KEYS}
    out.setdefault("station", config.station.model_dump())
    return out


def fingerprint(data: dict) -> str:
    """Changes when what would be sent changes (an orbit added later, ...), so the pass goes again. Not the
    size on the Pi, which deleting after upload changes."""
    data = {k: v for k, v in data.items() if k != "size"}
    return hashlib.sha1(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:16]


def pick(folder: Path, meta: dict, dest: Destination) -> list[dict]:
    """The images to send: chosen as Discord's are, and only those that could be read (they have a thumbnail)."""
    chosen = discord.pick_images(folder, meta, dest.images, MAX_IMAGES)
    return [i for i in chosen if not i.get("error") and passes.thumb_path(folder, i["path"]).is_file()]


def large_jpeg(folder: Path, rel: str, full_size: bool) -> bytes:
    if not full_size:
        return passes.large_version(folder, rel).read_bytes()
    img, _ = passes.rgb_copy(folder / rel, None)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=FULL_QUALITY, optimize=True)
    return buf.getvalue()


def prepare(folder: Path, meta: dict, dest: Destination) -> list[tuple[str, bytes, bytes]]:
    """(image path, thumbnail, large JPEG) of each image to send."""
    out = []
    for image in pick(folder, meta, dest):
        try:
            thumb = passes.thumb_path(folder, image["path"]).read_bytes()
            large = large_jpeg(folder, image["path"], dest.full_size)
        except (OSError, ValueError, Image.DecompressionBombError):
            continue            # unreadable after all: the pass goes without it
        out.append((image["path"], thumb, large))
    return out


# ---------- talking to the destination ----------

def file_url(dest: Destination, pass_id: str, kind: str, rel: str) -> str:
    path = "/".join(quote(part, safe="") for part in rel.split("/"))
    return f"{dest.url}/passes/{quote(pass_id, safe='')}/files/{kind}/{path}.jpg"


def client(dest: Destination) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(20, write=120),
                             headers={"Authorization": f"Bearer {dest.token}", "User-Agent": USER_AGENT})


async def call(c: httpx.AsyncClient, dest: Destination, method: str, url: str, **kwargs) -> dict:
    try:
        r = await c.request(method, url, **kwargs)
    except httpx.HTTPError as e:
        raise DestinationError(f"could not reach {dest.name}: {e}") from e
    if not r.is_success:
        try:
            data = r.json()
        except ValueError:
            data = {}
        message = data.get("error") if isinstance(data, dict) else None
        # 400 and 413 are about this pass; the rest (401 token, 404 URL, 429, 5xx) about the destination
        raise DestinationError(f"{dest.name} answered {r.status_code}: {message or r.reason_phrase}",
                               whole=r.status_code not in (400, 413))
    try:
        data = r.json()
    except ValueError:
        raise DestinationError(f"{dest.name} did not answer as a raspberry-sat hub does; check the URL")
    return data if isinstance(data, dict) else {}


def token_key(dest: Destination) -> str:
    return hashlib.sha256(f"{dest.url} {dest.token}".encode()).hexdigest()[:16]


def receiver_of(dest: Destination) -> str | None:
    """The hub's id for this Pi with this destination's URL and token, once known."""
    return _receivers.get(token_key(dest))


def remember_receiver(dest: Destination, receiver: object) -> None:
    if isinstance(receiver, str) and receiver:
        _receivers[token_key(dest)] = receiver


async def hello(dest: Destination) -> dict:
    """Which receiver this token is on the destination (Settings → Test): {"receiver": {"id", "name"},
    "protocol"}; hubs from before receivers answer "station" instead."""
    if not dest.url or not dest.token:
        raise DestinationError("set the URL and the token first")
    async with client(dest) as c:
        answer = await call(c, dest, "GET", f"{dest.url}/hello")
    who = answer.get("receiver") or answer.get("station")
    remember_receiver(dest, who.get("id") if isinstance(who, dict) else None)
    return answer


def save_note(folder: Path, name: str, note: dict) -> None:
    meta = passes.read_json(folder / passes.META)
    if meta is None:
        return                  # deleted meanwhile
    meta[STATE] = {**notes(meta), name: note}
    passes.write_meta(folder, meta)


def keep_station(folder: Path, config: Config) -> None:
    """A pass from before pass.json said which station received it: note the selected one, once, so what
    is sent doesn't change when another station is selected later. One from before stations had ids: give
    its copy the id that station got (made the same way from the same name and position)."""
    meta = passes.read_json(folder / passes.META)
    if meta is None:
        return
    station = meta.get("station")
    if not isinstance(station, dict):
        meta["station"] = config.station.model_dump()
    elif not station.get("id"):
        station["id"] = station_id(str(station.get("name", "")), station.get("lat") or 0.0,
                                   station.get("lon") or 0.0, station.get("alt") or 0.0)
    else:
        return
    passes.write_meta(folder, meta)


async def send_pass(folder: Path, config: Config, dest: Destination) -> dict:
    """Send a finished pass now and note it in its pass.json. Returns the note ({"id", "url", "uploaded_at",
    "images", "sent"}); on failure notes the error and when to try again, and raises DestinationError."""
    async with _sending:
        await asyncio.to_thread(keep_station, folder, config)
        meta = passes.load_pass(folder)
        if meta is None:
            raise DestinationError("this pass is still being received or decoded", whole=False)
        before = notes(meta).get(dest.name) or {}
        data = outgoing(meta, config)
        try:
            files = await asyncio.to_thread(prepare, folder, meta, dest)
            async with client(dest) as c:
                for rel, thumb, large in files:
                    for kind, body in (("thumb", thumb), ("large", large)):
                        await call(c, dest, "PUT", file_url(dest, folder.name, kind, rel), content=body,
                                   headers={"Content-Type": "image/jpeg"})
                answer = await call(c, dest, "POST", f"{dest.url}/passes/{quote(folder.name, safe='')}",
                                    json={"pass": data, "images": [rel for rel, _, _ in files]})
        except DestinationError as e:
            now = time.time()
            attempts = int(before.get("attempts") or 0) + 1
            kept = {k: v for k, v in before.items()
                    if k in ("id", "url", "uploaded_at", "images", "sent", "receiver")}
            # an earlier successful upload stays noted next to the error
            save_note(folder, dest.name, {**kept, "error": str(e), "failed_at": now, "attempts": attempts,
                                          "next_try": now + retry_delay(attempts)})
            raise
        remember_receiver(dest, answer.get("receiver"))
        note = {"id": answer.get("id"), "url": answer.get("url"), "uploaded_at": time.time(),
                "images": len(files), "sent": fingerprint(data), "receiver": answer.get("receiver")}
        save_note(folder, dest.name, note)
        return note


# ---------- what is due (the background job in tasks.py) ----------

def sent_to(note: dict, dest: Destination) -> bool:
    """The note says the pass is on `dest`: uploaded, and to the receiver this token is (when known; a note
    from before receivers counts as another receiver's)."""
    current = receiver_of(dest)
    return bool(note.get("uploaded_at")) and (current is None or note.get("receiver") == current)


def due(meta: dict, dest: Destination, config: Config, now: float) -> bool:
    """Whether automatic sending should send this pass to `dest` now: finished since sending was switched on
    (or "Send older passes"), and not there yet (or on another receiver), changed since, or its last try
    failed and the next is due."""
    if dest.mode != "auto" or float(meta.get("finished_at") or 0) < dest.since:
        return False
    note = notes(meta).get(dest.name) or {}
    if note.get("error"):
        return now >= float(note.get("next_try") or 0)
    if not sent_to(note, dest):
        return True
    return note.get("sent") != fingerprint(outgoing(meta, config))


def newest_first(passes_dir: Path) -> list[tuple[Path, dict]]:
    found = []
    for folder in passes.pass_folders(passes_dir):
        meta = passes.read_json(folder / passes.META)
        if meta is not None:
            found.append((folder, meta))
    return sorted(found, key=lambda fm: float(fm[1].get("time") or 0), reverse=True)


def waiting(name: str, now: float) -> bool:
    """The destination failed as a whole lately; its next try isn't due yet."""
    return name in _down and _down[name][0] > now


def went_down(name: str, now: float) -> int:
    """Note a failure of the whole destination; returns how many in a row."""
    failures = _down.get(name, (0.0, 0))[1] + 1
    _down[name] = (now + retry_delay(failures), failures)
    return failures


def came_back(name: str) -> bool:
    return _down.pop(name, None) is not None


async def learn_receivers(config: Config, now: float) -> list[tuple[Destination, DestinationError]]:
    """Ask each automatic destination, once per URL and token, which receiver this Pi is there (hello), so
    passes noted as sent to another receiver go again. Returns the destinations that failed, with why."""
    failed = []
    for dest in config.destinations:
        if dest.mode == "auto" and dest.url and dest.token and receiver_of(dest) is None \
                and not waiting(dest.name, now):
            try:
                await hello(dest)
            except DestinationError as e:
                failed.append((dest, e))
    return failed


def next_upload(passes_dir: Path, config: Config, now: float) -> tuple[Path, Destination] | None:
    """The newest finished pass that a destination set to automatic should get now."""
    ready = [d for d in config.destinations if d.mode == "auto" and not waiting(d.name, now)]
    if not ready:
        return None
    for folder, meta in newest_first(passes_dir):
        for dest in ready:
            if due(meta, dest, config, now):
                return folder, dest
    return None


def queued(passes_dir: Path, dest: Destination) -> int:
    """Passes not on `dest` yet."""
    return sum(1 for _, meta in newest_first(passes_dir) if not sent_to(notes(meta).get(dest.name) or {}, dest))


# ---------- deleting after upload ----------

def slim_due(folder: Path, meta: dict, config: Config, now: float) -> tuple[Destination, dict] | None:
    """(destination, its note) when this pass may be slimmed now: a destination set to delete after upload
    has it (and its last try didn't fail), it isn't slimmed yet, and, for a fresh pass with Discord posting
    automatically, Discord has posted it (it posts the images this deletes)."""
    if meta.get("slimmed"):
        return None
    found = None
    for dest in config.destinations:
        note = notes(meta).get(dest.name) or {}
        # on the receiver this token is now: not just once on one deleted from the hub since
        if dest.delete_after_upload and sent_to(note, dest) and not note.get("error"):
            found = dest, note
            break
    if found is None:
        return None
    cfg = config.discord
    fresh = now - float(meta.get("finished_at") or 0) < DISCORD_WAIT
    if fresh and cfg.mode == "auto" and not (meta.get("discord") or {}).get("posted_at") \
            and discord.worth_posting(folder, cfg):
        return None
    return found


def next_slim(passes_dir: Path, config: Config, now: float) -> tuple[Path, Destination, dict] | None:
    if not any(d.delete_after_upload for d in config.destinations):
        return None
    for folder, meta in newest_first(passes_dir):
        found = slim_due(folder, meta, config, now)
        if found:
            return folder, *found
    return None


def slim(folder: Path, dest: Destination, note: dict) -> int:
    """Delete all of the pass but the main image: SatDump's other images, its .cadu and data files, and the
    large JPEGs made of them. pass.json, signal.json and the thumbnails stay; the pass page links to the
    destination for the rest. Returns the bytes freed."""
    meta = passes.read_json(folder / passes.META)
    if meta is None:
        return 0
    main = meta.get("main")
    keep = {folder / main, passes.large_path(folder, main)} if main else set()
    freed = 0
    large_dir = folder / passes.THUMBS / "large"
    doomed = passes.satdump_files(folder) + ([f for f in large_dir.rglob("*") if f.is_file()] if large_dir.is_dir() else [])
    for f in doomed:
        if f not in keep:
            freed += f.stat().st_size
            f.unlink()
    # folders left empty, deepest first
    for d in sorted((p for p in folder.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()
    meta["slimmed"] = {"at": time.time(), "destination": dest.name, "url": note.get("url"), "freed": freed}
    meta["size"] = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
    passes.write_meta(folder, meta)
    return freed
