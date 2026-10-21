"""Pass folders under PASSES_DIR.

SatDump writes one folder per pass. Once a folder has been quiet for SETTLE seconds (SatDump keeps
decoding for a while after LOS) it is finished here: renamed to "<UTC start>_<satellite>"
(2026-10-12_1310Z_meteor-m2-3), given thumbnails in .thumbs/, and described in pass.json.
pass.json is what marks a pass as finished. SatDump's own files are left as they are.
"""

import bisect
import json
import math
import re
import time
from statistics import median
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from PIL import Image

from app import georef

SETTLE = 300                # seconds without a new file before a pass counts as finished
META = "pass.json"
SAMPLES = "signal.json"     # the signal samples taken during the pass, for the chart on the pass page
THUMBS = ".thumbs"          # thumbnails, and the large versions under .thumbs/large/
IMAGE_TYPES = {".png", ".jpg", ".jpeg"}
THUMB_WIDTH = 480
LARGE_WIDTH = 1600
VARIANTS = ("corrected", "map", "projected")   # suffixes SatDump appends to an image name

# the first of these that exists and is not black becomes the pass's main image;
# MCIR is infrared-based, so unlike MSA it also works for night passes
MAIN_PREFERENCE = [
    "msu_mr_rgb_MCIR_corrected",
    "msu_mr_rgb_MCIR_corrected_map",
    "msu_mr_rgb_MSA_corrected",
    "msu_mr_rgb_MSA_corrected_map",
]
DARK = 25                   # mean brightness (0-255) below which an image counts as black
EMPTY_ROW = 12              # a row whose brightest pixel is below this is a gap in reception


# ---------- folders ----------

def pass_folders(passes_dir: Path) -> list[Path]:
    if not passes_dir.is_dir():
        return []
    return [p for p in passes_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]


def is_finished(folder: Path) -> bool:
    return (folder / META).is_file()


def is_ours(folder: Path, f: Path) -> bool:
    rel = f.relative_to(folder)
    return rel.parts[0] == THUMBS or rel.as_posix() in (META, SAMPLES)


def satdump_files(folder: Path) -> list[Path]:
    return [f for f in folder.rglob("*") if f.is_file() and not is_ours(folder, f)]


def last_activity(folder: Path) -> float:
    return max((f.stat().st_mtime for f in satdump_files(folder)), default=folder.stat().st_mtime)


def active_folder(passes_dir: Path) -> Path | None:
    """The pass SatDump is writing, or last wrote, that is not finished yet."""
    unfinished = [f for f in pass_folders(passes_dir) if not is_finished(f)]
    return max(unfinished, key=last_activity, default=None)


def cadu_bytes(folder: Path) -> int:
    """Decoded frames so far (.cadu files; a Meteor LRPT frame is 1024 bytes)."""
    return sum(f.stat().st_size for f in folder.glob("*.cadu"))


def output_busy(passes_dir: Path, quiet: float = SETTLE) -> bool:
    """True while SatDump is still writing a pass (it keeps decoding for a while after LOS)."""
    now = time.time()
    return any(now - last_activity(f) < quiet for f in pass_folders(passes_dir) if not is_finished(f))


def folder_name(started: float, satellite: str) -> str:
    when = datetime.fromtimestamp(started, timezone.utc).strftime("%Y-%m-%d_%H%MZ")
    slug = re.sub(r"[^a-z0-9]+", "-", satellite.lower()).strip("-") or "unknown"
    return f"{when}_{slug}"


def unique_path(folder: Path, name: str) -> Path:
    """`name` next to `folder`, with -2, -3... added if another pass already has it."""
    if folder.name == name:
        return folder
    candidate, n = folder.with_name(name), 2
    while candidate.exists():
        candidate, n = folder.with_name(f"{name}-{n}"), n + 1
    return candidate


def pass_dir(passes_dir: Path, pass_id: str) -> Path | None:
    """The folder for an id from a URL, or None. Ids are plain folder names, never paths."""
    if not pass_id or pass_id.startswith(".") or "/" in pass_id or "\\" in pass_id:
        return None
    folder = passes_dir / pass_id
    return folder if folder.is_dir() else None


def file_in(folder: Path, rel: str) -> Path | None:
    """A file inside the pass folder, or None if it is missing or the path tries to leave the folder."""
    root = folder.resolve()
    f = (root / rel).resolve()
    return f if f.is_file() and root in f.parents else None


# ---------- images ----------

def describe_image(rel_path: str) -> dict:
    """What SatDump's file name says: 'MSU-MR/msu_mr_rgb_MSA_corrected_map.png'
    -> instrument MSU-MR, name 'MSA', variants ['corrected', 'map']."""
    p = PurePosixPath(rel_path)
    instrument = p.parts[0] if len(p.parts) > 1 else ""
    stem, variants = p.stem, []
    stripped = True
    while stripped:
        stripped = False
        for v in VARIANTS:
            if stem.endswith("_" + v):
                variants.insert(0, v)
                stem = stem[: -len(v) - 1]
                stripped = True
    prefix = instrument.lower().replace("-", "_") + "_"
    name = stem[len(prefix):] if instrument and stem.lower().startswith(prefix) else stem
    if name.startswith("rgb_"):
        name = name[4:]
    return {"path": rel_path, "instrument": instrument, "name": name.replace("_", " "), "variants": variants}


def thumb_path(folder: Path, rel: str) -> Path:
    return folder / THUMBS / (rel + ".jpg")


def large_path(folder: Path, rel: str) -> Path:
    return folder / THUMBS / "large" / (rel + ".jpg")


def rgb_copy(src: Path, width: int | None) -> tuple[Image.Image, tuple[int, int]]:
    """An 8-bit RGB copy at most `width` wide (None: full size), and the original's size."""
    with Image.open(src) as im:
        size = im.size
        if im.mode.startswith("I"):     # 16-bit: scale to 8-bit, a plain convert would clip it to white
            im = im.convert("I").point(lambda v: v * (1 / 256)).convert("L")
        out = im.convert("RGB")
    if width and out.width > width:
        out = out.resize((width, max(1, round(out.height * width / out.width))), Image.Resampling.LANCZOS)
    return out, size


def write_jpeg(src: Path, dst: Path, width: int) -> tuple[Image.Image, tuple[int, int]]:
    """A JPEG copy at most `width` wide. Returns it and the original's size."""
    out, size = rgb_copy(src, width)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "JPEG", quality=82, optimize=True)
    return out, size


def image_stats(img: Image.Image) -> tuple[float, float]:
    """(mean brightness 0-255, share of rows that received anything)."""
    gray = img.convert("L")
    w, h = gray.size
    px = gray.tobytes()
    filled = sum(1 for y in range(h) if max(px[y * w:(y + 1) * w]) >= EMPTY_ROW)
    return sum(px) / len(px), filled / h


def large_version(folder: Path, rel: str) -> Path:
    """A screen-sized JPEG of an image, made on first request: the PNGs are several MB each."""
    src = folder / rel
    dst = large_path(folder, rel)
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        write_jpeg(src, dst, LARGE_WIDTH)
    return dst


def drape_image(meta: dict) -> dict | None:
    """The image to place on a map: the raw version (not corrected, no map lines) of the main image's
    composite, as only raw images keep the scanner's geometry that SatDump's georeferencing describes."""
    images = [i for i in meta.get("images", []) if not i.get("error") and i.get("width") and i.get("height")]
    main = next((i for i in images if i["path"] == meta.get("main")), None)
    if main is None:
        return None
    return next((i for i in images if not i["variants"] and i["instrument"] == main["instrument"]
                 and i["name"] == main["name"]), None)


def choose_main(images: list[dict]) -> dict | None:
    usable = [i for i in images if "error" not in i]
    by_stem = {PurePosixPath(i["path"]).stem: i for i in usable}
    for stem in MAIN_PREFERENCE:
        i = by_stem.get(stem)
        if i and i["mean"] >= DARK:
            return i
    # another satellite or instrument: something not black, geometry-corrected if possible
    ranked = sorted(usable, key=lambda i: (i["mean"] < DARK, "corrected" not in i["variants"], i["path"]))
    return ranked[0] if ranked else None


# ---------- finishing a pass ----------

def read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_meta(folder: Path, meta: dict) -> None:
    tmp = folder / (META + ".tmp")
    tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    tmp.replace(folder / META)


EARLIEST = datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp()
# SatDump's automatic folder names start with the pass's UTC start: "2026-10-15_19-21_meteor_m2-x_lrpt_137.9 MHz"
SATDUMP_FOLDER_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})_")


def plausible_time(value) -> bool:
    return isinstance(value, (int, float)) and EARLIEST < value < time.time() + 86400


def time_from_name(name: str) -> float | None:
    m = SATDUMP_FOLDER_TIME.match(name)
    if not m:
        return None
    try:
        return datetime(*map(int, m.groups()), tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def pass_time(folder: Path, source_name: str, dataset: dict) -> float:
    """When the pass happened. dataset.json's timestamp when SatDump knew it (it writes -1 when the
    received data had no usable time), else the time in SatDump's folder name, else the oldest file."""
    if plausible_time(dataset.get("timestamp")):
        return float(dataset["timestamp"])
    return time_from_name(source_name) or \
        min((f.stat().st_mtime for f in satdump_files(folder)), default=folder.stat().st_mtime)


# (time of a pass) -> name of the satellite that was up then, or None; see tasks.guess_satellite
SatelliteGuess = Callable[[float], str | None]
# (time of a pass, satellite) -> {"orbit": ..., "signal": ..., "samples": [...]} as far as known; see tasks.pass_facts
PassFacts = Callable[[float, str], dict]


def known_satellite(name: str) -> bool:
    """SatDump names a Meteor from the received data; with nothing decoded it writes "Unknown Meteor"."""
    return bool(name) and not name.lower().startswith("unknown")


def pass_satellite(dataset: dict, started: float, guess: SatelliteGuess | None) -> str:
    """dataset.json's satellite when SatDump identified it, else the one the orbits say was up."""
    named = str(dataset.get("satellite") or "")
    if known_satellite(named):
        return named
    return (guess(started) if guess else None) or named or "unknown"


def repair(passes_dir: Path, guess: SatelliteGuess | None = None) -> list[tuple[str, str]]:
    """Fix finished passes saved before the fallbacks existed: SatDump's -1 timestamp (shown as 1969)
    and "Unknown Meteor". Corrects pass.json and the folder name. Returns [(old name, new name)]."""
    fixed = []
    for folder in pass_folders(passes_dir):
        meta = read_json(folder / META)
        if meta is None:
            continue
        changed = False
        if not plausible_time(meta.get("time")):
            meta["time"] = pass_time(folder, str(meta.get("source_name", "")), {})
            changed = True
        if not known_satellite(str(meta.get("satellite") or "")):
            name = pass_satellite({"satellite": meta.get("satellite")}, meta["time"], guess)
            if known_satellite(name):
                meta["satellite"] = name
                changed = True
        if not changed:
            continue
        old = folder.name
        target = unique_path(folder, folder_name(meta["time"], str(meta.get("satellite") or "unknown")))
        if target != folder:
            folder = folder.rename(target)
        write_meta(folder, meta)
        fixed.append((old, folder.name))
    return fixed


def add_orbits(passes_dir: Path, facts: PassFacts) -> int:
    """Give finished passes saved before pass.json had an orbit one (highest elevation, sky track).
    A pass no orbit matches gets null and is not tried again; without orbit data (no TLEs yet)
    nothing is written, so the next start tries again. Returns how many passes got an orbit."""
    added = 0
    for folder in pass_folders(passes_dir):
        meta = read_json(folder / META)
        if meta is None or "orbit" in meta:
            continue
        found = facts(float(meta.get("time") or 0), str(meta.get("satellite") or ""))
        if "orbit" not in found:
            continue
        meta["orbit"] = found["orbit"]
        write_meta(folder, meta)
        added += meta["orbit"] is not None
    return added


def finalize(folder: Path, guess: SatelliteGuess | None = None, facts: PassFacts | None = None) -> Path:
    """Rename the folder, make thumbnails, write pass.json. Returns the folder's new path."""
    source_name = folder.name
    dataset = read_json(folder / "dataset.json") or {}
    started = pass_time(folder, source_name, dataset)
    satellite = pass_satellite(dataset, started, guess)

    target = unique_path(folder, folder_name(started, satellite))
    if target != folder:
        folder = folder.rename(target)

    images = []
    for f in sorted(satdump_files(folder)):
        if f.suffix.lower() not in IMAGE_TYPES:
            continue
        rel = f.relative_to(folder).as_posix()
        info = describe_image(rel)
        info["bytes"] = f.stat().st_size
        try:
            thumb, (info["width"], info["height"]) = write_jpeg(f, thumb_path(folder, rel), THUMB_WIDTH)
            mean, coverage = image_stats(thumb)
            info["mean"], info["coverage"] = round(mean, 1), round(coverage, 3)
        except (OSError, Image.DecompressionBombError) as e:    # broken or half-written image
            info["error"] = str(e)
        images.append(info)

    main = choose_main(images)
    meta = {
        "version": 1,
        "satellite": satellite,
        "time": started,
        "source_name": source_name,
        "main": main["path"] if main else None,
        "coverage": main["coverage"] if main else None,
        "images": images,
        "size": sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()),
        "finished_at": time.time(),
        "orbit": None,          # AOS, LOS, highest elevation, sky track
        "signal": None,         # peak and mean SNR, share of the recording with lock
    }
    if facts:
        found = facts(started, satellite)
        samples = found.pop("samples", None)
        if samples:
            write_samples(folder, samples)
        meta.update(found)
    write_meta(folder, meta)
    return folder


DROP_LOOKBACK = 10      # samples (seconds) before a drop whose SNR tells what the signal was like


def sync_drops(samples: list[dict]) -> tuple[list[dict], dict[int, int]]:
    """Losses of sync during a pass's reception (between its first and last synced sample; the fade at the
    end is not one): where the satellite was, how long sync stayed lost, and the median SNR in the
    seconds before and during it. Also the seconds of that reception per 10° of elevation, so drops can
    be weighed by the time spent there."""
    locked = [s for s in samples if "deframer_lock" in s]
    synced = [i for i, s in enumerate(locked) if s["deframer_lock"]]
    if not synced:
        return [], {}
    span = locked[synced[0]:synced[-1] + 1]

    tracked: dict[int, int] = {}
    for i, s in enumerate(span):
        if isinstance(s.get("el"), (int, float)):
            band = min(80, max(0, int(s["el"] // 10) * 10))
            step = min(5.0, span[i + 1]["t"] - s["t"]) if i + 1 < len(span) else 1.0
            tracked[band] = tracked.get(band, 0) + step

    def snr(run: list[dict]) -> float | None:
        values = [s["snr"] for s in run if isinstance(s.get("snr"), (int, float))]
        return round(median(values), 1) if values else None

    drops, i = [], 0
    while i < len(span):
        if span[i]["deframer_lock"]:
            i += 1
            continue
        j = i
        while not span[j]["deframer_lock"]:       # the span ends synced, so this stops
            j += 1
        drops.append({
            "t": span[i]["t"], "el": span[i].get("el"), "az": span[i].get("az"),
            "seconds": round(span[j]["t"] - span[i]["t"], 1),
            "snr_before": snr(span[max(0, i - DROP_LOOKBACK):i]), "snr_during": snr(span[i:j]),
        })
        i = j
    return drops, {band: round(seconds) for band, seconds in sorted(tracked.items())}


def signal_summary(samples: list[dict]) -> dict | None:
    """Peak and mean SNR (dB) of a pass's samples, the share of them with the deframer locked, where
    frames first and last synced (the elevations at which reception starts and ends), and the losses of
    sync in between (sync_drops). Rebuilt samples have no SNR: then peak and mean are null."""
    snr = [s["snr"] for s in samples if isinstance(s.get("snr"), (int, float))]
    locks = [bool(s["deframer_lock"]) for s in samples if "deframer_lock" in s]
    if not snr and not locks:
        return None
    synced = [s for s in samples if s.get("deframer_lock")]
    drops, tracked = sync_drops(samples)

    def place(s: dict) -> dict:
        return {"t": s["t"], "el": s.get("el"), "az": s.get("az")}

    return {
        "peak_snr": round(max(snr), 1) if snr else None,
        "mean_snr": round(sum(snr) / len(snr), 1) if snr else None,
        "locked": round(sum(locks) / len(locks), 3) if locks else None,
        "seconds": round(samples[-1]["t"] - samples[0]["t"]),
        "first_sync": place(synced[0]) if synced else None,
        "last_sync": place(synced[-1]) if synced else None,
        "drops": drops,
        "tracked": tracked,         # seconds of reception per 10° of elevation
    }


# ---------- a signal rebuilt after the live one was lost ----------

REBUILD_NEAR = 0.7      # seconds: a second "has data" with a block of lines time-stamped this close (blocks ~1.23 s apart)


def product_file(folder: Path) -> Path | None:
    """SatDump's product.cbor of the pass's imager, with its line time stamps."""
    return next(iter(sorted(folder.glob("*/product.cbor"))), None)


def rebuild_samples(blocks: list[float], orbit: dict | None) -> list[dict]:
    """Second by second over the pass: whether image data arrived (a block of lines time-stamped within
    REBUILD_NEAR of it) and, from the orbit's sky track, where the satellite was. No SNR: SatDump only
    reports it live. Without an orbit, from the first to the last block, with no position."""
    times = sorted(blocks)
    if not times:
        return []
    track = (orbit or {}).get("track") or []
    if len(track) > 1:
        start, end = orbit["aos"], orbit["los"]
    else:
        start, end, track = times[0], times[-1], []
    step = (end - start) / (len(track) - 1) if track else 0
    samples = []
    for t in range(math.ceil(start), math.floor(end) + 1):
        k = bisect.bisect_left(times, t)
        near = any(abs(times[j] - t) <= REBUILD_NEAR for j in (k - 1, k) if 0 <= j < len(times))
        sample: dict = {"t": float(t), "deframer_lock": near}
        if track:
            f = (t - start) / step
            i = min(int(f), len(track) - 2)
            (az0, el0), (az1, el1) = track[i], track[i + 1]
            turn = (az1 - az0 + 180) % 360 - 180                  # the short way round north
            sample["az"] = round((az0 + (f - i) * turn) % 360, 1)
            sample["el"] = round(el0 + (f - i) * (el1 - el0), 1)
        samples.append(sample)
    return samples


def rebuild_signal(folder: Path) -> bool:
    """For a pass whose live signal was lost (the app stopped before the pass was finished): a signal
    rebuilt from SatDump's line time stamps and the orbit, marked "rebuilt" in pass.json. Never replaces
    a signal that was saved live. Returns whether it rebuilt one."""
    meta = read_json(folder / META)
    product = product_file(folder)
    if meta is None or product is None or load_samples(folder):
        return False
    samples = rebuild_samples(georef.data_times(product), meta.get("orbit"))
    if not samples:
        return False
    write_samples(folder, samples)
    summary = signal_summary(samples)
    if summary:
        summary["rebuilt"] = True
    meta["signal"] = summary
    write_meta(folder, meta)
    return True


def refresh_signal_summaries(passes_dir: Path) -> int:
    """Recompute the signal summary of finished passes saved before it had first/last sync, from their
    signal.json. Returns how many changed."""
    changed = 0
    for folder in pass_folders(passes_dir):
        meta = read_json(folder / META)
        if meta is None or "drops" in (meta.get("signal") or {}):
            continue
        samples = load_samples(folder)
        if not samples:
            continue
        rebuilt = (meta.get("signal") or {}).get("rebuilt")
        meta["signal"] = signal_summary(samples)
        if rebuilt and meta["signal"]:
            meta["signal"]["rebuilt"] = True
        write_meta(folder, meta)
        changed += 1
    return changed


def write_samples(folder: Path, samples: list[dict]) -> None:
    def short(v):
        return round(v, 3) if isinstance(v, float) else v
    data = [{k: short(v) for k, v in s.items()} for s in samples]
    (folder / SAMPLES).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def load_samples(folder: Path) -> list[dict]:
    try:
        data = json.loads((folder / SAMPLES).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def thin_samples(samples: list[dict], points: int) -> list[dict]:
    """About `points` samples for a small chart: each the mean time, elevation and SNR of a run of
    consecutive samples, synced when at least half of them were."""
    if len(samples) <= points:
        return samples
    out = []
    step = len(samples) / points
    for i in range(points):
        run = samples[round(i * step):round((i + 1) * step)]
        if not run:
            continue
        thin: dict = {}
        for key in ("t", "el", "snr"):
            values = [s[key] for s in run if isinstance(s.get(key), (int, float))]
            if values:
                thin[key] = round(sum(values) / len(values), 2)
        locks = [bool(s["deframer_lock"]) for s in run if "deframer_lock" in s]
        if locks:
            thin["deframer_lock"] = 2 * sum(locks) >= len(locks)
        out.append(thin)
    return out


def finalize_ready(passes_dir: Path, guess: SatelliteGuess | None = None,
                   facts: PassFacts | None = None) -> tuple[list[Path], list[tuple[str, str]]]:
    """Finish every pass that has gone quiet. Returns (finished folders, [(folder name, error)])."""
    done, errors = [], []
    now = time.time()
    for folder in pass_folders(passes_dir):
        if is_finished(folder) or now - last_activity(folder) < SETTLE:
            continue
        try:
            done.append(finalize(folder, guess, facts))
        except Exception as e:      # one bad folder must not stop the others
            errors.append((folder.name, f"{type(e).__name__}: {e}"))
    return done, errors


# ---------- reading ----------

def load_pass(folder: Path) -> dict | None:
    meta = read_json(folder / META)
    if meta is None:
        return None
    meta["id"] = folder.name
    return meta


def summary(meta: dict) -> dict:
    orbit, signal = meta.get("orbit") or {}, meta.get("signal") or {}
    return {
        "id": meta["id"],
        "satellite": meta.get("satellite", "unknown"),
        "time": meta.get("time", 0),
        "main": meta.get("main"),
        "coverage": meta.get("coverage"),
        "image_count": len(meta.get("images", [])),
        "size": meta.get("size", 0),
        "max_el": orbit.get("max_el"),
        "peak_snr": signal.get("peak_snr"),
        "mean_snr": signal.get("mean_snr"),
        "locked": signal.get("locked"),
        "first_sync": signal.get("first_sync"),
        "last_sync": signal.get("last_sync"),
        "drops": signal.get("drops"),
        "tracked": signal.get("tracked"),
        "rebuilt": bool(signal.get("rebuilt")),       # from line time stamps after the live signal was lost
        "discord_url": (meta.get("discord") or {}).get("url"),    # see discord.py
    }


def list_passes(passes_dir: Path) -> dict:
    finished, in_progress = [], []
    for folder in pass_folders(passes_dir):
        meta = load_pass(folder)
        if meta is not None:
            finished.append(summary(meta))
        else:
            in_progress.append({"id": folder.name, "last_activity": last_activity(folder)})
    finished.sort(key=lambda p: p["time"], reverse=True)
    in_progress.sort(key=lambda p: p["last_activity"], reverse=True)
    return {"passes": finished, "in_progress": in_progress}


def other_files(folder: Path) -> list[dict]:
    """SatDump's non-image files (dataset, telemetry, frames), for download."""
    files = [f for f in satdump_files(folder) if f.suffix.lower() not in IMAGE_TYPES]
    return [{"path": f.relative_to(folder).as_posix(), "bytes": f.stat().st_size} for f in sorted(files)]
