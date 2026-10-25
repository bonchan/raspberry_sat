// The drawing of a pass's signal over time, shared by SignalChart.tsx on the Pi and the hub's
// (hub/web/src/SignalChart.tsx): SNR, the predicted elevation behind it, and a strip that is green while
// frames sync. Plain TypeScript, no React, so the hub can import it as it is.

/** what the chart needs of a sample (LiveSample on the Pi) */
export interface PlotSample { t: number; snr?: number; el?: number | null; deframer_lock?: boolean }

/** the chart's own coordinates: the SVG's viewBox is W x H, stretched to the box it is in */
export const PLOT = { W: 600, H: 170, TOP: 6, BOTTOM: 146, STRIP: 152, STRIP_H: 12 }

export interface SignalPlot {
  ymax: number                                            // top of the SNR scale, dB
  grid: number[]                                          // y of the grid lines
  elevation: string                                       // polyline points; '' when there are none
  snr: string
  strips: { t: number; x: number; width: number; sync: boolean }[]
}

/** The chart from `start` to `end` (unix seconds). The elevation follows `track` ([az, el] spread evenly over
    the span) when there is one, else the samples' own elevations. */
export function signalPlot(samples: PlotSample[], start: number, end: number, track?: [number, number][]): SignalPlot {
  const { W, TOP, BOTTOM } = PLOT
  const x = (time: number) => ((time - start) / Math.max(1, end - start)) * W
  const snrs = samples.flatMap(s => (s.snr === undefined ? [] : [s.snr]))
  const ymax = Math.max(10, Math.ceil(Math.max(0, ...snrs) + 1))
  const ySnr = (v: number) => BOTTOM - (Math.max(0, v) / ymax) * (BOTTOM - TOP)
  const yEl = (v: number) => BOTTOM - (Math.max(0, v) / 90) * (BOTTOM - TOP)

  const step = track && track.length > 1 ? (end - start) / (track.length - 1) : 0
  const elevation = track
    ? track.map(([, el], i) => `${x(start + i * step)},${yEl(el)}`)
    : samples.flatMap(s => (s.el == null ? [] : [`${x(s.t)},${yEl(s.el)}`]))
  const snr = samples.flatMap(s => (s.snr === undefined ? [] : [`${x(s.t)},${ySnr(s.snr)}`]))
  const strips = samples.flatMap((s, i) => s.deframer_lock === undefined ? [] : [{
    t: s.t, x: x(s.t), width: Math.max(1, x(samples[i + 1]?.t ?? s.t + 1) - x(s.t)), sync: s.deframer_lock,
  }])
  return {
    ymax,
    grid: [0.25, 0.5, 0.75].map(f => TOP + f * (BOTTOM - TOP)),
    elevation: elevation.length > 1 ? elevation.join(' ') : '',
    snr: snr.length > 1 ? snr.join(' ') : '',
    strips,
  }
}
