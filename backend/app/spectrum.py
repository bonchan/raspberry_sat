"""SatDump's spectrum as numbers.

SatDump 1.2.2 serves its spectrum only as a 512x512 JPEG (/fft.jpeg, drawn by widgets::FFTPlot::drawImg):
grey dB lines and labels, and the trace as one cyan polyline whose point for pixel column n sits at
height 512 * (1 - (dB - FFT_MIN) / (FFT_MAX - FFT_MIN)), dB being the highest FFT bin in that column.
The columns run from the low to the high edge of the band, the tuned frequency in the middle. Reading
the cyan pixels back gives the trace, to a fraction of a dB.
"""

import io

import numpy as np
from PIL import Image

from app.satdump_cfg import FFT_MAX, FFT_MIN


def trace(jpeg: bytes, low: float = FFT_MIN, high: float = FFT_MAX) -> list[float | None]:
    """dB per pixel column, from the top of the trace in it; None where the trace is off the scale."""
    rgb = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cyan = (b > 120) & (g > 90) & (b - r > 60)      # the trace is (0, 237, 255); lines and labels are grey
    height = rgb.shape[0]
    top = np.where(cyan.any(axis=0), cyan.argmax(axis=0), -1)
    return [None if y < 0 else round(high - y / height * (high - low), 1) for y in top.tolist()]
