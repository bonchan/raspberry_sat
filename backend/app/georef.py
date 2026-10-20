"""Where a pass's image lies on Earth, so the globe on the Live page can drape it over the map.

SatDump writes the georeferencing next to the images: MSU-MR/product.cbor holds a time stamp per block
of lines, the TLE it used and the scanner's geometry (projection_cfg). This follows SatDump 1.2.2's own
"normal_single_line" projection, the one behind its *_map.png overlays:
src-core/common/projection/sat_proj/normal_line_proj.h, timestamp_filtering.cpp and
src-core/common/geodetic/euler_raytrace.cpp. Each image line is one scan across the track at its time:
the ray starts at the satellite's geodetic nadir, is rolled about the velocity by the column's scan
angle, pitched, and meets the WGS84 ellipsoid. The positions are worked out for a grid of lines and
columns only; the browser stretches the image between them.
"""

import math
from pathlib import Path

import cbor2
from sgp4.api import Satrec
from skyfield.sgp4lib import theta_GMST1982

A = 6378.137                    # WGS84 semi-major axis, km
F = 1 / 298.257223563
B = A * (1 - F)                 # semi-minor axis
E2 = F * (2 - F)                # first eccentricity squared

Vec = tuple[float, float, float]


# ---------- small vector helpers ----------

def add(a: Vec, b: Vec) -> Vec:
    return a[0] + b[0], a[1] + b[1], a[2] + b[2]


def sub(a: Vec, b: Vec) -> Vec:
    return a[0] - b[0], a[1] - b[1], a[2] - b[2]


def scale(a: Vec, k: float) -> Vec:
    return a[0] * k, a[1] * k, a[2] * k


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]


def rotate(a: Vec, axis: Vec, theta: float) -> Vec:
    """`a` rotated about `axis` by `theta` radians (SatDump's rotate_vector_a_around_b)."""
    parallel = scale(axis, dot(a, axis) / dot(axis, axis))
    ortho = sub(a, parallel)
    w = cross(axis, ortho)
    n_ortho, n_w = math.sqrt(dot(ortho, ortho)), math.sqrt(dot(w, w))
    if n_ortho == 0 or n_w == 0:
        return a
    turned = add(scale(ortho, math.cos(theta)), scale(w, math.sin(theta) * n_ortho / n_w))
    return add(turned, parallel)


# ---------- the Earth ----------

def geodetic(p: Vec) -> tuple[float, float]:
    """(latitude, longitude) in radians of a point given in an Earth-centred frame."""
    x, y, z = p
    r = math.hypot(x, y)
    lat = math.atan2(z, r * (1 - E2))
    for _ in range(5):
        n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
        lat = math.atan2(z + E2 * n * math.sin(lat), r)
    return lat, math.atan2(y, x)


def surface(lat: float, lon: float) -> Vec:
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    return n * math.cos(lat) * math.cos(lon), n * math.cos(lat) * math.sin(lon), n * (1 - E2) * math.sin(lat)


def hit_ellipsoid(origin: Vec, direction: Vec) -> Vec | None:
    """Where a ray from `origin` first meets the WGS84 ellipsoid (SatDump's formula, a = b = A, c = B)."""
    a2, c2 = A * A, B * B
    u, v, w = direction
    x, y, z = origin
    value = -a2 * a2 * w * z - a2 * c2 * v * y - a2 * c2 * u * x
    radical = (a2 * a2 * w * w + a2 * c2 * v * v - a2 * v * v * z * z + 2 * a2 * v * w * y * z - a2 * w * w * y * y
               + a2 * c2 * u * u - a2 * u * u * z * z + 2 * a2 * u * w * x * z - a2 * w * w * x * x
               - c2 * u * u * y * y + 2 * c2 * u * v * x * y - c2 * v * v * x * x)
    magnitude = a2 * a2 * w * w + a2 * c2 * v * v + a2 * c2 * u * u
    if radical < 0 or magnitude == 0:
        return None
    d = (value - A * A * B * math.sqrt(radical)) / magnitude
    return None if d < 0 else add(origin, scale(direction, d))


# ---------- SatDump's time stamps ----------

def filter_timestamps(stamps: list[float], cfg: dict) -> list[float]:
    """timestamp_filtering::filter_timestamps_simple: drop stamps far from the median or out of order (-1)."""
    tf = cfg.get("timefilter") or {}
    if tf.get("type") != "simple" or not stamps:
        return list(stamps)
    total = tf["scan_time"] * len(stamps)
    tolerate = total * 0.5 + total * tf.get("margin", 1.5)
    median = sorted(stamps)[len(stamps) // 2]
    out, last = [], -1.0
    for v in stamps:
        if v == -1:
            out.append(-1)
        elif abs(median - v) > tolerate or last >= v or abs(last - v) > tf["max_diff"]:
            last = v
            out.append(-1)
        else:
            last = v
            out.append(v)
    return out


def line_times(stamps: list[float], cfg: dict) -> list[float]:
    """One time per image line: each stamp covers `interpolate_timestamps` lines (try_interpolate_timestamps)."""
    n = cfg.get("interpolate_timestamps")
    if not n:
        return list(stamps)
    step = cfg["interpolate_timestamps_scantime"]
    return [-1 if t == -1 else t + i * step for t in stamps for i in range(-(n // 2), n // 2)]


# ---------- the grid ----------

def georeference(product: Path, width: int, height: int, rows: int = 64, cols: int = 25) -> dict | None:
    """Latitude and longitude of a grid of pixels of an image `width` x `height` from this product's
    instrument, or None when the product has no usable projection for an image that size."""
    data = cbor2.loads(product.read_bytes())
    cfg, tle = data.get("projection_cfg") or {}, data.get("tle") or {}
    if cfg.get("type") != "normal_single_line" or cfg.get("image_width") != width or not tle.get("line1"):
        return None
    # the line times of the channel closest to the image's height: a composite has its channels' height,
    # or a few lines less when SatDump cut it to its shortest channel (same first line)
    channels = [line_times(filter_timestamps(img.get("timestamps") or [], cfg), cfg) for img in data.get("images", [])]
    tall_enough = [t for t in channels if len(t) >= height]
    if not tall_enough:
        return None
    times = min(tall_enough, key=len)[:height]

    sat = Satrec.twoline2rv(tle["line1"], tle["line2"])
    scan_angle = cfg["scan_angle"]
    invert = cfg.get("invert_scan", False)
    roll_offset, pitch, yaw = cfg.get("roll_offset", 0.0), cfg.get("pitch_offset", 0.0), cfg.get("yaw_offset", 0.0)
    offset = cfg.get("timestamp_offset", 0.0)

    step = max(1, math.ceil((height - 1) / (rows - 1)))
    grid_rows = sorted(set(range(0, height, step)) | {height - 1})
    grid_cols = sorted({round(i * (width - 1) / (cols - 1)) for i in range(cols)})
    points: list[list[float] | None] = []
    for y in grid_rows:
        t = times[y]
        if t == -1:
            points.extend([None] * len(grid_cols))
            continue
        days = (t + offset) / 86400 + 2440587.5
        jd, fr = math.floor(days), days - math.floor(days)
        error, position, velocity = sat.sgp4(jd, fr)          # km and km/s, TEME
        if error:
            points.extend([None] * len(grid_cols))
            continue
        theta, _ = theta_GMST1982(jd, fr)                     # Earth's rotation: TEME -> Earth-fixed
        # the ellipsoid is symmetric about the pole, so the geometry works in TEME directly
        nadir = sub(surface(*geodetic(position)), position)
        heading = rotate(velocity, nadir, math.radians(yaw))
        across = rotate(heading, nadir, math.radians(90))
        for x in grid_cols:
            final_x = x if invert else (width - 1) - x
            roll = -((final_x - width / 2) / width * scan_angle) + roll_offset - 0.06
            ray = rotate(nadir, heading, math.radians(roll))
            ray = rotate(ray, across, math.radians(pitch))
            hit = hit_ellipsoid(position, ray)
            if hit is None:
                points.append(None)
                continue
            fixed = (math.cos(theta) * hit[0] + math.sin(theta) * hit[1], -math.sin(theta) * hit[0] + math.cos(theta) * hit[1], hit[2])
            lat, lon = geodetic(fixed)
            points.append([round(math.degrees(lat), 4), round(math.degrees(lon), 4)])
    return {"width": width, "height": height, "rows": grid_rows, "cols": grid_cols, "points": points}
