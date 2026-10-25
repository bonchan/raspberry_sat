"""Posting passes to a Discord channel: one message with the pass's facts and one image per composite.

It posts as a bot: an application made in Discord's developer portal, invited to the server (Settings builds
the invite link from the application ID). Only Discord's plain HTTP API is used, no gateway connection.
Where and when a pass was posted, or why posting failed, goes into its pass.json under "discord".
"""

import asyncio
import io
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import httpx
from PIL import Image

from app import passes
from app.config import Config, Discord

API = "https://discord.com/api/v10"
USER_AGENT = "DiscordBot (https://github.com/bonchan/raspberry_sat, 1)"   # the form Discord asks bots for
MAX_FILES = 10                  # attachments per message
MAX_BYTES = 20 * 1024 * 1024    # all images together; Discord takes up to 25 MiB per message
WIDTHS = (None, 1600, 1000)     # full size when it fits, smaller when the images together are too large
QUALITY = 85
MAX_TEXT = 2000                 # characters of message text
# which variant of a composite to post, best first; the main image's composite posts the main image
VARIANT_ORDER = (["corrected"], ["corrected", "map"], [], ["map"])
STATE = "discord"               # key in pass.json

transport: httpx.AsyncBaseTransport | None = None   # tests put a mock here
_posting = asyncio.Lock()       # one post at a time: Discord's rate limits, and each post rewrites pass.json


class DiscordError(Exception):
    """Discord refused the message or could not be reached; the text says what to fix."""


# ---------- the message ----------

TEXT = {
    "en": {
        "max_el": "Highest elevation **{el}°** at {tca}",
        "sky": "{start}–{end} ({minutes} min), {frm} → {to}",
        "signal": "Signal: peak {peak} dB, average {mean} dB",
        "locked": "locked {p} of the time",
        "received": "Received {p} of the main image",
        "no_images": "No images: nothing was decoded.",
        "station": "Station {name}",
        "test": "raspberry_sat can post here. Passes will appear in this channel.",
    },
    "es": {
        "max_el": "Elevación máxima **{el}°** a las {tca}",
        "sky": "{start}–{end} ({minutes} min), {frm} → {to}",
        "signal": "Señal: pico {peak} dB, promedio {mean} dB",
        "locked": "sincronía {p} del tiempo",
        "received": "Recibido {p} de la imagen principal",
        "no_images": "Sin imágenes: no se decodificó nada.",
        "station": "Estación {name}",
        "test": "raspberry_sat puede publicar acá. Las pasadas van a aparecer en este canal.",
    },
}
COMPASS = {
    "en": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    "es": ["N", "NE", "E", "SE", "S", "SO", "O", "NO"],
}


def texts(lang: str) -> dict:
    return TEXT.get(lang, TEXT["en"])


def compass(az: float, lang: str) -> str:
    return COMPASS.get(lang, COMPASS["en"])[round(az / 45) % 8]


def percent(share: float) -> str:
    return f"{round(share * 100)}%"


def plain(text: str) -> str:
    """`text` with Discord's formatting characters escaped, so a name shows as typed."""
    return re.sub(r"([\\*_~`|>])", r"\\\1", text)


def stamp(unix: float, style: str) -> str:
    """A Discord timestamp: every reader sees it in their own time zone and language."""
    return f"<t:{int(unix)}:{style}>"


def words(text: str) -> str:
    """'MCIR  Corrected + map' -> 'mcir corrected map'"""
    return " ".join(re.sub(r"[+_,]", " ", text).casefold().split())


# variant words as the pass page shows them in Spanish, to the ones in SatDump's file names
VARIANT_WORDS = {"cruda": "raw", "corregida": "corrected", "mapa": "map", "proyectada": "projected"}


def entry_match(entry: str, image: dict) -> str | None:
    """How an "Images to post" entry names `image`: "image" for this very file ("MCIR corrected",
    "MCIR corrected map", "MCIR raw", or its file name), "composite" for its composite ("MCIR"), else None."""
    path = PurePosixPath(image["path"])
    if entry.strip().casefold() in {image["path"].casefold(), path.name.casefold(), path.stem.casefold()}:
        return "image"
    key, name = words(entry), words(image["name"])
    if key == name:
        return "composite"
    if key.startswith(name + " "):
        asked = {VARIANT_WORDS.get(w, w) for w in key[len(name) + 1:].split()}
        if asked == set(image["variants"] or ["raw"]):
            return "image"
    return None


def pick_images(folder: Path, meta: dict, wanted: list[str], limit: int = MAX_FILES) -> list[dict]:
    """The images to post, at most `limit`. Any image whose file is there, however it looks.
    `wanted` empty: one per composite, the main image first, then by name, each composite's variant
    from VARIANT_ORDER. Otherwise in the order of `wanted`; an entry naming a composite gets that variant.
    Also picks what destinations.py sends."""
    images = [i for i in meta.get("images", []) if (folder / i["path"]).is_file()]
    groups: dict[tuple[str, str], list[dict]] = {}
    for image in images:
        groups.setdefault((image["instrument"], image["name"]), []).append(image)

    def rank(image: dict) -> int:
        if image["path"] == meta.get("main"):
            return -1
        variants = image["variants"]
        return VARIANT_ORDER.index(variants) if variants in VARIANT_ORDER else len(VARIANT_ORDER)

    if not wanted:
        chosen = [min(group, key=rank) for group in groups.values()]
        chosen.sort(key=lambda i: (i["path"] != meta.get("main"), i["name"].casefold()))
        return chosen[:limit]
    chosen = []
    for entry in wanted:
        found = [i for i in images if entry_match(entry, i) == "image"] or \
                [min(g, key=rank) for g in groups.values() if entry_match(entry, g[0]) == "composite"]
        chosen += [i for i in found if i not in chosen]
    return chosen[:limit]


def message_text(meta: dict, has_images: bool, station: str, lang: str) -> str:
    """The text above the images."""
    t = texts(lang)
    when = float(meta.get("time") or 0)
    utc = datetime.fromtimestamp(when, timezone.utc).strftime("%H:%M UTC")
    lines = [f"## {plain(str(meta.get('satellite') or 'unknown'))}", f"{stamp(when, 'F')} · {utc}"]
    orbit = meta.get("orbit")
    if orbit:
        lines.append(t["max_el"].format(el=round(orbit["max_el"]), tca=stamp(orbit["tca"], "t")) + " · " +
                     t["sky"].format(start=stamp(orbit["aos"], "t"), end=stamp(orbit["los"], "t"),
                                     minutes=round((orbit["los"] - orbit["aos"]) / 60),
                                     frm=compass(orbit["aos_az"], lang), to=compass(orbit["los_az"], lang)))
    signal = meta.get("signal")
    if signal:
        line = t["signal"].format(peak=f"{signal['peak_snr']:.1f}", mean=f"{signal['mean_snr']:.1f}")
        if signal.get("locked") is not None:
            line += " · " + t["locked"].format(p=percent(signal["locked"]))
        lines.append(line)
    if meta.get("coverage") is not None:
        lines.append(t["received"].format(p=percent(meta["coverage"])))
    if not has_images:
        lines.append(t["no_images"])
    lines.append("-# " + t["station"].format(name=plain(station)))
    return "\n".join(lines)[:MAX_TEXT]


def file_name(image: dict, taken: set[str]) -> str:
    """'MCIR_corrected': what readers see when they open the image, without the extension."""
    base = re.sub(r"[^A-Za-z0-9.-]+", "_", " ".join([image["name"], *image["variants"]])).strip("_") or "image"
    name, n = base, 2
    while name in taken:
        name, n = f"{base}-{n}", n + 1
    taken.add(name)
    return name


CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}

# (file name, bytes, content type)
Upload = tuple[str, bytes, str]


def encode(src: Path, name: str, width: int | None) -> Upload:
    """A JPEG at most `width` wide; SatDump's file as it is when it cannot be read as an image."""
    try:
        img, _ = passes.rgb_copy(src, width)
    except (OSError, ValueError, Image.DecompressionBombError):
        return name + src.suffix.lower(), src.read_bytes(), CONTENT_TYPES.get(src.suffix.lower(), "image/png")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=QUALITY, optimize=True)
    return name + ".jpg", buf.getvalue(), "image/jpeg"


def encode_images(folder: Path, images: list[dict]) -> list[Upload]:
    """The images named for Discord, as large as fits in one message (the last ones are left out if even
    the smallest size is too much)."""
    taken: set[str] = set()
    names = [file_name(i, taken) for i in images]
    files: list[Upload] = []
    for width in WIDTHS:
        files = [encode(folder / i["path"], name, width) for name, i in zip(names, images)]
        if sum(len(f[1]) for f in files) <= MAX_BYTES:
            return files
    while files and sum(len(f[1]) for f in files) > MAX_BYTES:
        files.pop()
    return files


# ---------- talking to Discord ----------

# Discord's error codes, and HTTP statuses for the errors that come without one
HINTS = {
    401: "the bot token is wrong; copy it again (developer portal → Bot → Reset Token)",
    10003: "no channel has that ID; copy it again (right-click the channel → Copy Channel ID)",
    50001: "the bot cannot see that channel; add it to the server with the invite link in Settings, "
           "and check that the channel lets it in",
    50013: "the bot may not post there; give it Send Messages and Attach Files in that channel",
    40005: "the images are too large for one message",
}


def explain(r: httpx.Response) -> str:
    try:
        data = r.json()
    except ValueError:
        data = {}
    data = data if isinstance(data, dict) else {}
    hint = HINTS.get(data.get("code")) or HINTS.get(r.status_code)
    text = f"Discord answered {r.status_code} ({data.get('message') or r.reason_phrase})"
    return f"{text}: {hint}" if hint else text


async def call(client: httpx.AsyncClient, method: str, path: str, token: str, **kwargs) -> dict:
    """One request to Discord's API, waiting once if it says to slow down."""
    headers = {"Authorization": f"Bot {token}", "User-Agent": USER_AGENT}
    r = await client.request(method, API + path, headers=headers, **kwargs)
    if r.status_code == 429:
        try:
            wait = float(r.json().get("retry_after", 1))
        except (ValueError, AttributeError):
            wait = 1.0
        await asyncio.sleep(min(wait, 30))
        r = await client.request(method, API + path, headers=headers, **kwargs)
    if not r.is_success:
        raise DiscordError(explain(r))
    return r.json()


async def send(cfg: Discord, text: str, files: list[Upload]) -> dict:
    """Post one message to the configured channel. Returns {"url": link to the message, "channel": its name}."""
    if not cfg.bot_token or not cfg.channel_id:
        raise DiscordError("set the bot token and the channel ID in Settings first")
    payload = {"content": text, "allowed_mentions": {"parse": []}}
    async with httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(20, write=180)) as client:
        try:
            channel = await call(client, "GET", f"/channels/{cfg.channel_id}", cfg.bot_token)
            path = f"/channels/{cfg.channel_id}/messages"
            if files:
                payload["attachments"] = [{"id": n, "filename": f[0]} for n, f in enumerate(files)]
                message = await call(client, "POST", path, cfg.bot_token,
                                     data={"payload_json": json.dumps(payload)},
                                     files=[(f"files[{n}]", f) for n, f in enumerate(files)])
            else:
                message = await call(client, "POST", path, cfg.bot_token, json=payload)
        except httpx.HTTPError as e:
            raise DiscordError(f"could not reach Discord: {e}") from e
    server = channel.get("guild_id") or "@me"
    return {"url": f"https://discord.com/channels/{server}/{cfg.channel_id}/{message.get('id')}",
            "channel": channel.get("name")}


async def send_test(cfg: Discord, lang: str) -> dict:
    return await send(cfg, texts(lang)["test"], [])


def save_note(folder: Path, note: dict) -> None:
    meta = passes.read_json(folder / passes.META)
    if meta is None:
        return                      # deleted while it was being posted
    meta[STATE] = note
    passes.write_meta(folder, meta)


async def post_pass(folder: Path, config: Config) -> dict:
    """Post a finished pass and note the result in its pass.json. Returns the note
    ({"posted_at", "url", "channel", "images"}); on failure notes the error and raises DiscordError."""
    async with _posting:
        meta = passes.load_pass(folder)
        if meta is None:
            raise DiscordError("this pass is still being received or decoded")
        images = pick_images(folder, meta, config.discord.composites)
        try:
            files = await asyncio.to_thread(encode_images, folder, images)
        except OSError as e:
            raise DiscordError(f"could not read the images: {e}") from e
        text = message_text(meta, bool(files), config.station.name, config.display.language)
        try:
            sent = await send(config.discord, text, files)
        except DiscordError as e:
            # an earlier successful post stays noted next to the error
            save_note(folder, {**(meta.get(STATE) or {}), "error": str(e), "failed_at": time.time()})
            raise
        note = {"posted_at": time.time(), **sent, "images": len(files)}
        save_note(folder, note)
        return note


def worth_posting(folder: Path, cfg: Discord) -> bool:
    """For automatic posting: the pass has images to show, or empty passes are posted too."""
    return cfg.post_failed or bool(pick_images(folder, passes.load_pass(folder) or {}, cfg.composites))
