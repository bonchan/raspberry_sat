"""Background jobs that run for the app's lifetime."""

import asyncio
import json
import logging
import time
from pathlib import Path

import httpx

from app import destinations, discord, orbits, passes, settings, spectrum, updater
from app.config import load_config
from app.hub import hub
from app.satdump_cfg import FFT_MAX, FFT_MIN
from app.supervisor import supervisor

log = logging.getLogger(__name__)


def guess_satellite(when: float) -> str | None:
    """For passes SatDump could not identify: the configured satellite that was up then, from the orbits."""
    try:
        return orbits.satellite_up(load_config(settings.CONFIG_FILE), orbits.load_tles(settings.SATDUMP_TLES), when)
    except Exception:
        log.exception("could not work out which satellite a pass was")
        return None

http = httpx.AsyncClient(timeout=5)

POLL_INTERVAL = 1
WATCHED_POLL = 0.25         # seconds between reads of SatDump's status while the Live page follows a pass
WATCH_HOLD = 5              # ... for this long after the page last asked
HISTORY_STEP = 1            # seconds between the samples kept for the pass chart (and signal.json)
LIVE_SIGNAL = "live_signal.jsonl"   # in the data dir: the current pass's samples as they come
LIVE_SAVE = 5               # seconds between writes to it: a crash or power cut loses no more than that
HOUSEKEEPING_INTERVAL = 15
SCAN_INTERVAL = 30
DAILY_RESTART = 24 * 3600   # SatDump only refreshes its orbit data (TLEs) when it starts
UPDATE_CHECK_INTERVAL = 6 * 3600


SIGNAL_KEYS = ("snr", "peak_snr", "freq", "viterbi_ber", "viterbi_lock", "deframer_lock", "rs_avg")


def signal(data: dict) -> dict:
    """SNR, lock and sync from SatDump's live pipeline stats, whichever modules report them
    (for Meteor: psk_demod and ccsds_conv_concat_decoder)."""
    out = {}
    for stats in (data.get("live_pipeline") or {}).values():
        if isinstance(stats, dict):
            out.update({k: stats[k] for k in SIGNAL_KEYS if k in stats})
    return out


class Tracker:
    """The last status read from SatDump's own web server (/api), and the current pass's signal history."""

    def __init__(self) -> None:
        self.data: dict | None = None
        self.updated_at = 0.0
        self.pass_started = 0.0         # when the current or last pass began
        self.last_los = 0.0             # when the last pass ended (or SatDump stopped during one)
        self.history: list[dict] = []   # one sample a second during the current or last pass
        self.watched_until = 0.0        # someone has the Live page open: poll faster until then
        self._was_receiving = False

    def watch(self) -> None:
        self.watched_until = time.time() + WATCH_HOLD

    def watched(self) -> bool:
        return time.time() < self.watched_until

    def overhead(self) -> bool:
        """The tracked satellite is above the horizon, whether SatDump records this pass or not."""
        t = (self.data or {}).get("object_tracker") or {}
        return not t.get("next_event_is_aos", True) and t.get("next_los_time", 0) > time.time()

    def receiving(self) -> bool:
        """SatDump is decoding or recording a pass right now. Its tracker follows every pass,
        but passes under the minimum elevation are skipped: no SDR, no pipeline, no data."""
        data = self.data or {}
        return "live_pipeline" in data or "recording" in data

    def update(self, data: dict | None) -> None:
        now = time.time()
        self.data = data
        if data is not None:
            self.updated_at = now
        receiving = self.receiving()
        if receiving and not self._was_receiving:
            self.pass_started, self.history = now, []
        if self._was_receiving and not receiving:
            self.last_los = now
        if receiving and data is not None and (not self.history or now - self.history[-1]["t"] >= HISTORY_STEP - 0.1):
            self.history.append(self.sample(data, now))
        self._was_receiving = receiving

    @staticmethod
    def sample(data: dict, now: float) -> dict:
        pos = (data.get("object_tracker") or {}).get("sat_current_pos") or {}
        return {"t": round(now, 1), "az": pos.get("az"), "el": pos.get("el"), **signal(data)}

    def current(self) -> dict | None:
        """The latest reading during a pass, as fresh as the polling (the history keeps one a second)."""
        return self.sample(self.data, self.updated_at) if self.receiving() and self.data else None


tracker = Tracker()


class LiveSignalFile:
    """The current pass's samples on disk, written every LIVE_SAVE seconds: a header line with when the
    pass began, then one sample per line, appended. Only the samples are kept in memory otherwise, so
    without this a crash, power cut or reboot before the pass is finished loses its signal."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.started: float | None = None       # the pass the file holds
        self.saved_t = 0.0                      # time of the last sample written
        self.saved_at = 0.0

    def save(self, tracker: Tracker, now: float) -> None:
        if not tracker.history or now - self.saved_at < LIVE_SAVE:
            return
        self.saved_at = now
        new_pass = tracker.pass_started != self.started
        fresh = tracker.history if new_pass else [s for s in tracker.history if s["t"] > self.saved_t]
        if not fresh:
            return
        try:
            with self.path.open("w" if new_pass else "a", encoding="utf-8") as f:
                if new_pass:
                    f.write(json.dumps({"pass_started": tracker.pass_started}) + "\n")
                f.writelines(json.dumps(s) + "\n" for s in fresh)
        except OSError:
            log.exception("could not save the live signal")
            return
        self.started, self.saved_t = tracker.pass_started, fresh[-1]["t"]


def load_live_signal(path: Path) -> dict | None:
    """What LiveSignalFile saved of the last pass before the app stopped: {"pass_started", "samples"}.
    A line cut short by the stop is skipped."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    rows = []
    for line in lines:
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    if not rows or "pass_started" not in rows[0]:
        return None
    samples = [r for r in rows[1:] if isinstance(r, dict) and "t" in r]
    return {"pass_started": rows[0]["pass_started"], "samples": samples} if samples else None


live_signal = LiveSignalFile(settings.DATA_DIR / LIVE_SIGNAL)
recovered: dict | None = None       # the last pass's samples from before this start, if the app stopped


def pass_facts(started: float, satellite: str) -> dict:
    """For pass.json: the pass's orbit (highest elevation, sky track) and, when this app watched it,
    its signal summary and samples (saved next to it as signal.json). No "orbit" key when there is
    no orbit data to tell; null when no pass matches."""
    facts: dict = {}
    try:
        tles = orbits.load_tles(settings.SATDUMP_TLES)
    except OSError:
        tles = None                 # SatDump has not downloaded orbit data yet
    if tles is not None:
        try:
            facts["orbit"] = orbits.pass_geometry(load_config(settings.CONFIG_FILE), tles, started, satellite)
        except Exception:
            log.exception("could not work out the orbit of a pass")
    # the tracker keeps the last pass's samples until the next one starts; after a crash, power cut or
    # reboot, the samples saved while it was received
    candidates = [(tracker.pass_started, tracker.history)]
    if recovered:
        candidates.append((recovered["pass_started"], recovered["samples"]))
    for began, samples in candidates:
        if samples and abs(began - started) < 15 * 60:
            facts["signal"] = passes.signal_summary(samples)
            facts["samples"] = list(samples)
            break
    return facts


def new_pass_facts(started: float, satellite: str) -> dict:
    """pass_facts for a pass being finished, plus the station that received it: the one selected now.
    Stations move, and the hub (destinations.py) shows where each pass came from."""
    return {**pass_facts(started, satellite), "station": load_config(settings.CONFIG_FILE).station.model_dump()}


# ---------- what the pages show, for the REST endpoints and the WebSocket topics alike ----------

def status_view() -> dict:
    """SatDump's process and its status server's last answer (topic "status", GET /api/status)."""
    return {
        "satdump": supervisor.snapshot(),
        "tracker": tracker.data,
        "tracker_age": time.time() - tracker.updated_at if tracker.data else None,
        "receiving": tracker.receiving(),
        "overhead": tracker.overhead(),
    }


def live_files() -> dict:
    folder = passes.active_folder(settings.PASSES_DIR)
    return {"folder": folder.name if folder else None, "cadu_bytes": passes.cadu_bytes(folder) if folder else 0}


def live_view(after: float = 0) -> dict:
    """The current (or last) pass as it happens: signal samples newer than `after`, the latest reading,
    data received so far (GET /api/live; the topic "live" starts with it)."""
    return {
        "receiving": tracker.receiving(),
        "pass_started": tracker.pass_started,
        "last_los": tracker.last_los,
        "history": [s for s in tracker.history if s["t"] > after],
        "current": tracker.current(),
        **live_files(),
    }


class NoSpectrum(Exception):
    pass


async def read_spectrum() -> dict:
    """SatDump's spectrum as dB values (spectrum.py), 512 across the band, the tuned frequency in the
    middle. SatDump only computes it while someone asks, and stops 10 s after the last time."""
    try:
        r = await http.get(f"http://{settings.SATDUMP_HTTP}/fft.jpeg")
    except httpx.HTTPError as e:
        raise NoSpectrum("SatDump is not answering") from e
    if r.status_code != 200 or not r.content:
        raise NoSpectrum("SatDump has no spectrum yet")
    db = await asyncio.to_thread(spectrum.trace, r.content)
    return {
        "db": db, "min": FFT_MIN, "max": FFT_MAX,
        "frequency": (tracker.data or {}).get("frequency"),
        "samplerate": load_config(settings.CONFIG_FILE).sdr.samplerate,
        "time": time.time(),
    }


STALE_AFTER = 10            # seconds without an answer from SatDump before the pages say so
SPECTRUM_FRESH = 2          # a spectrum read this recently: a tab shows it and the SDR is running
FILES_EVERY = 5             # seconds between looks at the pass folder outside a pass (decoding after LOS)

spectrum_at = 0.0           # when the last spectrum was read (push_spectrum)


def spectrum_shown() -> bool:
    """A tab shows the spectrum and SatDump has one, so the SDR is on (between passes: when the settings
    keep it on)."""
    return hub.watching("spectrum") and time.time() - spectrum_at < SPECTRUM_FRESH


def stale() -> bool:
    """SatDump runs but its status server stopped answering."""
    return tracker.data is not None and time.time() - tracker.updated_at > STALE_AFTER


def pace() -> str:
    """How closely the pages follow SatDump:
    "fast"   a pass is being recorded, or a tab shows the spectrum: every read, four a second while the
             Live page is open;
    "steady" a satellite is overhead but too low to record, or SatDump stopped answering: once a second;
    "quiet"  otherwise: only when something on the pages changes. They work out where the satellites are
             and the time themselves (from the orbit data and their clock)."""
    if tracker.receiving() or spectrum_shown():
        return "fast"
    if tracker.overhead() or stale():
        return "steady"
    return "quiet"


def _second(t: float | None) -> int | None:
    return round(t) if isinstance(t, (int, float)) else None


def status_key(view: dict) -> tuple:
    """What the pages show from the status when nothing is overhead: the position and the age of the
    answer change on every read, these only when something happens."""
    data = view["tracker"] or {}
    t = data.get("object_tracker") or {}
    return (view["satdump"], view["receiving"], view["overhead"], view["tracker"] is None,
            t.get("object_name"), t.get("next_event_is_aos"), _second(t.get("next_aos_time")),
            _second(t.get("next_los_time")), data.get("frequency"))


class TrackerPush:
    """After each read of SatDump: its status (topic "status"), its process when that changed ("satdump"),
    and the live signal ("live": during a pass the latest reading every time and a new sample once a
    second; otherwise only when it changed). How often the status goes out: pace()."""

    def __init__(self) -> None:
        self.process: dict | None = None
        self.status: tuple | None = None    # status_key of the last read
        self.sample_t = 0.0                 # time of the last sample sent
        self.files = {"folder": None, "cadu_bytes": 0}
        self.files_at = 0.0
        self.live: dict | None = None       # the last "live" update sent

    def __call__(self) -> None:
        view = status_view()
        key = status_key(view)
        if hub.watching("status") and (key != self.status or pace() != "quiet"):
            hub.publish("status", view)
        self.status = key
        process = supervisor.snapshot()
        if process != self.process:
            self.process = process
            hub.publish("satdump", process)
        if not hub.watching("live"):
            return
        receiving = tracker.receiving()
        now = time.time()
        update = {"kind": "update", "receiving": receiving, "pass_started": tracker.pass_started,
                  "last_los": tracker.last_los, "current": tracker.current()}
        latest = tracker.history[-1] if tracker.history else None
        if latest and latest["t"] > self.sample_t:
            self.sample_t = latest["t"]
            update["sample"] = latest
            self.files, self.files_at = live_files(), now   # the folder and the data in it: once a second is plenty
        elif not receiving and now - self.files_at >= FILES_EVERY:
            self.files, self.files_at = live_files(), now   # after LOS: decoding, then finished
        message = {**update, **self.files}
        if receiving or message != self.live:
            self.live = message
            hub.publish("live", message)


push_tracker = TrackerPush()

SPECTRUM_EVERY = 0.25       # seconds between spectra while a tab shows it


async def push_spectrum() -> None:
    """The spectrum four times a second while a tab shows it (topic "spectrum", null while SatDump has
    none); nothing otherwise."""
    global spectrum_at
    while True:
        if not hub.watching("spectrum"):
            await asyncio.sleep(0.5)
            continue
        try:
            hub.publish("spectrum", await read_spectrum())
            spectrum_at = time.time()
        except NoSpectrum:
            hub.publish("spectrum", None)
        except Exception:
            log.exception("reading the spectrum failed")
        await asyncio.sleep(SPECTRUM_EVERY)


hub.topic("status", status_view)
hub.topic("satdump", supervisor.snapshot)
hub.topic("live", lambda: {"kind": "snapshot", **live_view()})
hub.topic("spectrum")


async def poll_tracker() -> None:
    while True:
        if supervisor.state == "running":
            try:
                r = await http.get(f"http://{settings.SATDUMP_HTTP}/api")
                r.raise_for_status()
                tracker.update(r.json())
            except (httpx.HTTPError, ValueError):
                pass                        # still starting up; the page shows how old the data is
        else:
            tracker.update(None)
        live_signal.save(tracker, time.time())
        push_tracker()
        # faster while a tab shows a pass or the spectrum on the Live page (or asks over REST)
        fast = pace() == "fast" and (tracker.watched() or hub.watching("live"))
        await asyncio.sleep(WATCHED_POLL if fast else POLL_INTERVAL)


def safe_to_restart() -> bool:
    return not tracker.receiving() and not passes.output_busy(settings.PASSES_DIR)


UPDATE_LEAD = 5 * 60       # seconds kept free before a recorded pass: an update takes a few minutes


def update_blocker() -> dict | None:
    """Why an update has to wait, or None. An update loads the CPU while it rebuilds the page, then restarts
    the app and SatDump: not while a pass is received or decoded, nor shortly before the next recorded one."""
    if tracker.receiving():
        return {"reason": "receiving", "message": "a pass is being received; update after it ends"}
    if passes.output_busy(settings.PASSES_DIR):
        return {"reason": "decoding", "message": "SatDump is still decoding the last pass; update when it is done"}
    if not supervisor.wanted:
        return None                 # SatDump stopped by hand records nothing
    try:
        upcoming = orbits.schedule.get(load_config(settings.CONFIG_FILE), settings.SATDUMP_TLES)["passes"]
    except Exception:
        log.exception("could not predict passes for the update check")
        return None
    now = time.time()
    soon = next((p for p in upcoming if p["scheduled"] and p["aos"] - now < UPDATE_LEAD), None)
    if soon is None:
        return None
    return {"reason": "pass_soon", "satellite": soon["name"], "aos": soon["aos"],
            "message": f"{soon['name']} passes over soon; update after that pass"}


async def housekeeping() -> None:
    while True:
        await asyncio.sleep(HOUSEKEEPING_INTERVAL)
        try:
            if supervisor.restart_pending and supervisor.wanted:
                if supervisor.state != "running" or safe_to_restart():
                    await supervisor.restart(supervisor.restart_reason)
            elif supervisor.state == "running" and supervisor.uptime() > DAILY_RESTART and safe_to_restart():
                await supervisor.restart("daily restart, refreshes orbit data")
        except Exception:
            log.exception("housekeeping failed")


async def check_updates() -> None:
    """git fetch now and then, so the page can say when there is something new."""
    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(updater.check, True)
        except Exception:
            log.exception("update check failed")
        await asyncio.sleep(UPDATE_CHECK_INTERVAL)


UPLOAD_INTERVAL = 60        # seconds between looks for passes to send to destinations


async def send_to_destinations() -> None:
    """Send finished passes to the destinations set to automatic, newest first and one after another, then
    delete what destinations set to delete after upload have (destinations.py). Not while SatDump receives
    or decodes a pass: that needs the CPU."""
    await asyncio.sleep(UPLOAD_INTERVAL)
    while True:
        worked = False
        try:
            if not tracker.receiving() and not await asyncio.to_thread(passes.output_busy, settings.PASSES_DIR):
                worked = await destination_step(load_config(settings.CONFIG_FILE))
        except Exception:
            log.exception("sending passes to destinations failed")
        await asyncio.sleep(1 if worked else UPLOAD_INTERVAL)


async def destination_step(config) -> bool:
    """One upload, or else one deletion after upload, if any is due. Returns whether it did one."""
    now = time.time()
    # which receiver this Pi is on each destination: passes sent to another one go again
    for dest, e in await destinations.learn_receivers(config, now):
        if e.whole and destinations.went_down(dest.name, time.time()) == 1:
            supervisor.note("error", f"could not reach {dest.name}: {e}; trying again in a minute, then less "
                                     "and less often")
    job = await asyncio.to_thread(destinations.next_upload, settings.PASSES_DIR, config, now)
    if job:
        folder, dest = job
        try:
            note = await destinations.send_pass(folder, config, dest)
        except destinations.DestinationError as e:
            if e.whole:
                # the destination is down or refuses this station: one line, not one per pass and try
                if destinations.went_down(dest.name, time.time()) == 1:
                    supervisor.note("error", f"could not send passes to {dest.name}: {e}; trying again in a "
                                             "minute, then less and less often")
            else:
                note = destinations.notes(passes.read_json(folder / passes.META) or {}).get(dest.name) or {}
                if note.get("attempts") == 1:
                    supervisor.note("error", f"{dest.name} refused pass {folder.name}: {e}")
            return False
        finally:
            hub.nudge("passes")
        if destinations.came_back(dest.name):
            supervisor.note("info", f"{dest.name} takes passes again")
        supervisor.note("info", f"sent pass {folder.name} to {dest.name} with {note['images']} images")
        return True

    slim = await asyncio.to_thread(destinations.next_slim, settings.PASSES_DIR, config, now)
    if slim:
        folder, dest, note = slim
        freed = await asyncio.to_thread(destinations.slim, folder, dest, note)
        supervisor.note("info", f"pass {folder.name} is on {dest.name}: deleted all but its main image "
                                f"from the Pi ({freed / 1e6:.0f} MB)")
        hub.nudge("passes")
        return True
    return False


async def scan_passes() -> None:
    """Finish passes SatDump is done with: rename, thumbnails, pass.json.

    Right away when SatDump says a pass's images are written ("Pipeline Processing Done!"); otherwise
    (passes copied in by hand, SatDump stopped mid-decode) once a folder has been quiet for SETTLE.
    """
    reported: set[str] = set()          # folders whose error was already logged
    global recovered
    recovered = await asyncio.to_thread(load_live_signal, live_signal.path)

    try:
        for old, new in await asyncio.to_thread(passes.repair, settings.PASSES_DIR, guess_satellite):
            supervisor.note("info", f"pass {old}: time or satellite name from SatDump fixed; now {new}")
    except Exception:
        log.exception("repairing pass times failed")
    try:
        added = await asyncio.to_thread(passes.add_orbits, settings.PASSES_DIR, pass_facts)
        if added:
            supervisor.note("info", f"added the orbit (highest elevation, sky track) to {added} earlier passes")
    except Exception:
        log.exception("adding orbits to earlier passes failed")
    try:
        await asyncio.to_thread(passes.refresh_signal_summaries, settings.PASSES_DIR)
    except Exception:
        log.exception("updating the signal summaries of earlier passes failed")

    def report_error(name: str, error: str) -> None:
        if name not in reported:
            reported.add(name)
            supervisor.note("error", f"could not finish pass {name}: {error}")

    while True:
        try:
            folder = await asyncio.wait_for(supervisor.passes_done.get(), SCAN_INTERVAL)
        except asyncio.TimeoutError:
            folder = None

        if folder is not None:
            if folder.is_dir() and not passes.is_finished(folder):
                try:
                    await pass_finished(await finish(folder))
                except Exception as e:
                    report_error(folder.name, f"{type(e).__name__}: {e}")
            continue

        if tracker.receiving() or time.time() - tracker.last_los < passes.SETTLE:
            continue                    # SatDump is receiving, or may still be decoding: leave its folders alone
        try:
            done, errors = await asyncio.to_thread(passes.finalize_ready, settings.PASSES_DIR, guess_satellite,
                                                   new_pass_facts)
        except Exception:
            log.exception("pass scan failed")
            continue
        for folder in done:
            await pass_finished(folder)
        for name, error in errors:
            report_error(name, error)


finishing = {"folder": None, "done": 0, "total": 0}     # the pass whose thumbnails are being made (processing.py)


def thumbnail_made(done: int, total: int) -> None:
    finishing.update(done=done, total=total)


async def finish(folder: Path) -> Path:
    """passes.finalize once SatDump is done with a pass, its thumbnails counted for the topic "processing"."""
    finishing.update(folder=folder, done=0, total=0)
    try:
        return await asyncio.to_thread(passes.finalize, folder, guess_satellite, new_pass_facts, thumbnail_made)
    finally:
        finishing["folder"] = None
        hub.nudge("processing")


async def pass_finished(folder) -> None:
    """Say a pass is ready, and post it to Discord when that is automatic."""
    report_ready(folder)
    config = load_config(settings.CONFIG_FILE)
    if config.discord.mode != "auto" or not discord.worth_posting(folder, config.discord):
        return
    try:
        note = await discord.post_pass(folder, config)
        supervisor.note("info", f"posted pass {folder.name} to Discord with {note['images']} images")
    except discord.DiscordError as e:
        supervisor.note("error", f"could not post pass {folder.name} to Discord: {e}")
    except Exception:
        log.exception("posting pass %s to Discord failed", folder.name)


def report_ready(folder) -> None:
    meta = passes.load_pass(folder) or {}
    text = f"pass {folder.name} ready: {len(meta.get('images', []))} images"
    if meta.get("coverage") is not None:
        text += f", {meta['coverage']:.0%} of the main image received"
    if meta.get("orbit"):
        text += f", highest elevation {meta['orbit']['max_el']:.0f}°"
    if (meta.get("signal") or {}).get("peak_snr") is not None:
        text += f", peak SNR {meta['signal']['peak_snr']} dB"
    supervisor.note("info", text)
    hub.nudge("passes")
