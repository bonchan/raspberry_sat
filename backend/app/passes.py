"""Pass folders under PASSES_DIR.

SatDump writes one folder per pass. Once a folder has been quiet for SETTLE seconds (SatDump keeps
decoding for a while after LOS) it is finished here: renamed to "<UTC start>_<satellite>"
(2026-10-12_1310Z_meteor-m2-3), given thumbnails in .thumbs/, and described in pass.json.
pass.json is what marks a pass as finished. SatDump's own files are left as they are.
"""

import json
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from PIL import Image

SETTLE = 300                # seconds without a new file before a pass counts as finished
META = "pass.json"
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
    return rel.parts[0] == THUMBS or rel.as_posix() == META


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


def write_jpeg(src: Path, dst: Path, width: int) -> tuple[Image.Image, tuple[int, int]]:
    """A JPEG copy at most `width` wide. Returns it and the original's size."""
    with Image.open(src) as im:
        size = im.size
        if im.mode.startswith("I"):     # 16-bit: scale to 8-bit, a plain convert would clip it to white
            im = im.convert("I").point(lambda v: v * (1 / 256)).convert("L")
        out = im.convert("RGB")
    if out.width > width:
        out = out.resize((width, max(1, round(out.height * width / out.width))), Image.Resampling.LANCZOS)
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


def finalize(folder: Path, guess: SatelliteGuess | None = None) -> Path:
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
    }
    write_meta(folder, meta)
    return folder


def finalize_ready(passes_dir: Path, guess: SatelliteGuess | None = None) -> tuple[list[Path], list[tuple[str, str]]]:
    """Finish every pass that has gone quiet. Returns (finished folders, [(folder name, error)])."""
    done, errors = [], []
    now = time.time()
    for folder in pass_folders(passes_dir):
        if is_finished(folder) or now - last_activity(folder) < SETTLE:
            continue
        try:
            done.append(finalize(folder, guess))
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
    return {
        "id": meta["id"],
        "satellite": meta.get("satellite", "unknown"),
        "time": meta.get("time", 0),
        "main": meta.get("main"),
        "coverage": meta.get("coverage"),
        "image_count": len(meta.get("images", [])),
        "size": meta.get("size", 0),
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
