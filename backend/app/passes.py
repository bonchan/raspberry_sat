"""Pass folders SatDump writes under PASSES_DIR, one per pass, named by UTC start time
("2026-10-15_10-31_meteor_m2-x_lrpt_137.900 MHz"), so name order is time order."""

import time
from pathlib import Path


def newest_pass_folder(passes_dir: Path) -> Path | None:
    if not passes_dir.is_dir():
        return None
    folders = sorted(p for p in passes_dir.iterdir() if p.is_dir())
    return folders[-1] if folders else None


def output_busy(passes_dir: Path, quiet: float = 180) -> bool:
    """True while the newest pass is still being written: SatDump keeps decoding for a while after LOS."""
    newest = newest_pass_folder(passes_dir)
    if newest is None:
        return False
    times = [f.stat().st_mtime for f in newest.rglob("*") if f.is_file()] or [newest.stat().st_mtime]
    return time.time() - max(times) < quiet
