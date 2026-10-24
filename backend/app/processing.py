"""How far a pass is after LOS, for the topic "processing" (the Live page and the header).

After LOS SatDump works on the pass in two steps: it turns the frames into the instruments' data, then
makes the images and composites from that. It only says how far it is in the first, short step
("Progress 45.3%" every 10 s). The images, most of the wait, come with no progress at all, so that part is
an estimate: the images written so far against how many recent passes of the same satellite at the same
time of day ended up with. Last the app makes the thumbnails, which it counts exactly.
"""

import asyncio
import statistics
import time
from pathlib import Path

from app import orbits, passes, settings, tasks
from app.supervisor import supervisor

DECODE = 10             # percent when the first step is done
IMAGES = 90             # ... and when the images are all written; the thumbnails take the rest
SAME_SLOT = 3 * 3600    # seconds of time of day: passes this close are lit alike, so they make the same images
RECENT = 5              # earlier passes the image count to expect is taken from
DONE_GRACE = 60         # seconds after SatDump is done during which its pass shows as being finished


def time_of_day_apart(a: float, b: float) -> float:
    d = abs(a - b) % 86400
    return min(d, 86400 - d)


def expected_images(earlier: list[dict], satellite: str | None, started: float) -> int | None:
    """How many images the pass will likely end up with: the median of the latest passes of the same
    satellite at the same time of day (night passes make other composites than day ones), failing those
    of the same satellite, failing those of any. `earlier`: passes.list_passes, newest first."""
    with_images = [p for p in earlier if p["image_count"] > 0]
    name = orbits.simple_name(satellite or "")
    same = [p for p in with_images if name and orbits.simple_name(p["satellite"]) == name]
    slot = [p for p in same if time_of_day_apart(p["time"], started) <= SAME_SLOT]
    for group in (slot, same, with_images):
        if group:
            return round(statistics.median(p["image_count"] for p in group[:RECENT]))
    return None


def count_images(folder: Path) -> int:
    try:
        return sum(1 for f in passes.satdump_files(folder) if f.suffix.lower() in passes.IMAGE_TYPES)
    except OSError:
        return 0                    # renamed or removed meanwhile


def percent(decoded: float | None, images: int, expected: int | None) -> int | None:
    """Before the first image: SatDump's own progress in the first step. Then the images written against
    those expected (kept under IMAGES: only SatDump knows when it has made the last one)."""
    if images == 0:
        return round(DECODE * min(100.0, decoded or 0.0) / 100)
    if not expected:
        return None
    return min(IMAGES - 1, DECODE + round((IMAGES - DECODE) * images / expected))


class Progress:
    def __init__(self) -> None:
        self.known: dict[Path, tuple[str | None, int | None]] = {}

    def about(self, folder: Path) -> tuple[str | None, int | None]:
        """The pass's satellite and the images to expect, worked out once per pass."""
        if folder not in self.known:
            started = passes.time_from_name(folder.name) or time.time()
            satellite = tasks.guess_satellite(started)
            earlier = passes.list_passes(settings.PASSES_DIR)["passes"]
            self.known = {folder: (satellite, expected_images(earlier, satellite, started))}
        return self.known[folder]

    def working_on(self, started: list[Path], receiving: bool) -> Path | None:
        """The oldest pass SatDump started and has not finished, apart from the one it is receiving."""
        if receiving:
            started = started[:-1]
        return next((f for f in started if f.is_dir() and not passes.is_finished(f)), None)

    def work(self, started: list[Path], receiving: bool, finishing: dict, done: tuple[Path, float] | None,
             step: str | None, decoded: float | None) -> dict | None:
        if finishing["folder"] is not None:             # the app is making the thumbnails
            folder = finishing["folder"]
            share = finishing["done"] / finishing["total"] if finishing["total"] else 0
            return self.view(folder, "thumbnails", IMAGES + round((100 - IMAGES) * share))
        if done and done[0].is_dir() and not passes.is_finished(done[0]) and time.time() - done[1] < DONE_GRACE:
            return self.view(done[0], "thumbnails", IMAGES)     # SatDump is done; the app is about to start
        folder = self.working_on(started, receiving)
        if folder is None:
            return None
        _, expected = self.about(folder)
        images = count_images(folder)
        return self.view(folder, "images" if images else "decode", percent(decoded if step else None, images, expected))

    def view(self, folder: Path, step: str, share: int | None) -> dict:
        satellite, _ = self.about(folder)
        return {"pass": folder.name, "satellite": satellite, "step": step, "percent": share}


progress = Progress()


async def view() -> dict | None:
    """The topic "processing": the pass being worked on after LOS and how far it is ({"pass", "satellite",
    "step": "decode" | "images" | "thumbnails", "percent": 0-100, or null when there is nothing to go by
    yet}), or null when there is none."""
    # what other tasks change is copied here, in the event loop; the folders are looked at in a thread
    return await asyncio.to_thread(
        progress.work, list(supervisor.decoding), tasks.tracker.receiving(), dict(tasks.finishing),
        supervisor.last_done, supervisor.step, supervisor.step_progress)
