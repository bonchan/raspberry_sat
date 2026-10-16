// Signal over a pass: on the Live page while it happens, on the pass page afterwards (from signal.json).

import type { LiveSample } from './api'
import { utcClock } from './format'
import { useT } from './i18n'

/** SNR over the pass, the predicted elevation behind it, and a strip that is green while frames sync. */
export default function SignalChart({ samples, start, end, track }: {
  samples: LiveSample[]; start: number; end: number; track?: [number, number][]
}) {
  const t = useT()
  const W = 600, H = 170, TOP = 6, BOTTOM = 146, STRIP = 152
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

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(f => <line key={f} className="chart-grid" x1={0} x2={W} y1={TOP + f * (BOTTOM - TOP)} y2={TOP + f * (BOTTOM - TOP)} />)}
        {elevation.length > 1 && <polyline className="chart-el" points={elevation.join(' ')} />}
        {snr.length > 1 && <polyline className="chart-snr" points={snr.join(' ')} />}
        {samples.map((s, i) => s.deframer_lock === undefined ? null : (
          <rect key={s.t} className={s.deframer_lock ? 'chart-sync' : 'chart-nosync'}
            x={x(s.t)} y={STRIP} height={12}
            width={Math.max(1, x(samples[i + 1]?.t ?? s.t + 1) - x(s.t))} />
        ))}
      </svg>
      <p className="hint chart-legend">
        <span className="key snr" /> {t('live.chartSnr', { max: ymax })} <span className="key el" /> {t('live.chartEl')}
        <span className="key sync" /> {t('live.chartSync')} <span className="key nosync" /> {t('live.chartNoSync')}
        <span className="chart-times">{utcClock(start)}–{utcClock(end)} UTC</span>
      </p>
    </>
  )
}
