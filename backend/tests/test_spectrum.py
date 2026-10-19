import io

from PIL import Image, ImageDraw

from app import spectrum
from app.satdump_cfg import FFT_MAX, FFT_MIN


def satdump_like_jpeg(values: list[float]) -> bytes:
    """Draws a spectrum the way SatDump's FFTPlot::drawImg does: grey scale lines, a cyan polyline."""
    size = 512
    img = Image.new("RGB", (size, size), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i in range(0, size + 1, size // 40):
        draw.line([(0, i), (size - 1, i)], fill=(102, 102, 102))
    y = [size * (1 - (v - FFT_MIN) / (FFT_MAX - FFT_MIN)) for v in values]
    for n in range(1, size):
        draw.line([(n - 1, y[n - 1]), (n, y[n])], fill=(0, 237, 255))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90)
    return out.getvalue()


def test_trace_reads_back_the_values():
    # a -72 dB floor with an 8 dB wide hump in the middle, like a Meteor pass
    values = [-72 + (8 if 220 <= n < 290 else 0) for n in range(512)]
    read = spectrum.trace(satdump_like_jpeg(values))
    assert len(read) == 512
    assert all(abs(r - v) < 1 for r, v in zip(read[5:215], values[5:215]))
    assert all(abs(r - v) < 1 for r, v in zip(read[225:285], values[225:285]))


def test_trace_off_the_scale_is_none():
    read = spectrum.trace(satdump_like_jpeg([FFT_MIN - 20] * 512))
    assert all(r is None or r <= FFT_MIN + 1 for r in read)
