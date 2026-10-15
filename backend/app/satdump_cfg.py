"""Our Config -> the JSON file `satdump autotrack` reads.

Keys follow SatDump 1.2.2 (src-cli/autotrack/autotrack.cpp, common/tracking/scheduler/scheduler.h).
"""

from pathlib import Path

from app.config import Config

# SatDump always connects a rotctl rotator at startup; with none wanted, point it where nothing listens
NO_ROTATOR = {"address": "127.0.0.1", "port": 1}
FALLBACK_FREQUENCY = 137_900_000


def build_autotrack_config(config: Config, output_folder: Path, http_server: str) -> dict:
    enabled = [s for s in config.satellites if s.enabled]
    sdr = config.sdr

    parameters = {
        "source": sdr.source,
        "samplerate": sdr.samplerate,
        "initial_frequency": enabled[0].frequency_hz if enabled else FALLBACK_FREQUENCY,
        "gain": sdr.gain,
        "agc": sdr.agc,
        "bias": sdr.bias,
        "ppm_correction": sdr.ppm_correction,
        # the spectrum is only computed while someone looks at it on the status page
        "fft_enable": True,
        "fft_size": 8192,
        "fft_rate": 10,
        "fft_min": -110,
        "fft_max": -30,
    }
    if sdr.source_id:
        parameters["source_id"] = sdr.source_id

    if config.rotator.enabled:
        rotator = {"address": config.rotator.address, "port": config.rotator.port}
    else:
        rotator = NO_ROTATOR

    return {
        "output_folder": str(output_folder),
        "http_server": http_server,
        "finish_processing": True,          # without it a live Meteor pipeline stops at frames, no images
        "qth": {"lat": config.station.lat, "lon": config.station.lon, "alt": config.station.alt},
        "tracked_objects": [
            {
                "norad": s.norad,
                "min_elevation": s.min_elevation,
                "downlinks": [{
                    "frequency": s.frequency_hz,
                    "live": True,
                    "record": config.storage.keep_baseband,
                    "pipeline_name": s.pipeline,
                    "baseband_format": "cs8",   # the RTL-SDR is 8-bit anyway: half the size of the default cs16
                }],
            }
            for s in enabled
        ],
        "tracking": {
            "autotrack_cfg": {
                "autotrack_min_elevation": config.tracking.min_elevation,
                "stop_sdr_when_idle": config.tracking.stop_sdr_when_idle,
                "multi_mode": False,
                "use_localtime": False,
            },
            "rotator_cfg": rotator,
            "rotator_algo": {"update_period": 1.0},
        },
        "parameters": parameters,
    }
