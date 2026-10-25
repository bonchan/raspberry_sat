// Signal over a pass: on the Live page while it happens, on the pass page afterwards (from signal.json).

import type { LiveSample } from './api'
import { clock, compass, utcClock } from './format'
import { useT } from './i18n'
import { PLOT, signalPlot } from './signalPlot'

/** The first and last samples with frames syncing: the elevations where reception starts and ends. */
export function syncEnds(samples: LiveSample[]): { first: LiveSample; last: LiveSample } | null {
  const synced = samples.filter(s => s.deframer_lock)
  return synced.length ? { first: synced[0], last: synced[synced.length - 1] } : null
}

/** {el}, {time} and {dir} of a sample, for the sync texts */
export const syncPlace = (s: LiveSample) => ({
  el: s.el != null ? s.el.toFixed(0) : '?', time: clock(s.t), dir: s.az != null ? compass(s.az) : '?',
})

/** SNR over the pass, the predicted elevation behind it, and a strip that is green while frames sync.
    bare: the chart alone, without legend or sync text (the pass list). */
export default function SignalChart({ samples, start, end, track, bare = false }: {
  samples: LiveSample[]; start: number; end: number; track?: [number, number][]; bare?: boolean
}) {
  const t = useT()
  const plot = signalPlot(samples, start, end, track)
  const ymax = plot.ymax
  const ends = syncEnds(samples)
  const syncKnown = samples.some(s => s.deframer_lock !== undefined)

  return (
    <>
      <svg className={bare ? 'chart bare' : 'chart'} viewBox={`0 0 ${PLOT.W} ${PLOT.H}`} preserveAspectRatio="none">
        {plot.grid.map(y => <line key={y} className="chart-grid" x1={0} x2={PLOT.W} y1={y} y2={y} />)}
        {plot.elevation && <polyline className="chart-el" points={plot.elevation} />}
        {plot.snr && <polyline className="chart-snr" points={plot.snr} />}
        {plot.strips.map(s => (
          <rect key={s.t} className={s.sync ? 'chart-sync' : 'chart-nosync'}
            x={s.x} y={PLOT.STRIP} height={PLOT.STRIP_H} width={s.width} />
        ))}
      </svg>
      {!bare && <p className="hint chart-legend">
        <span className="key snr" /> {t('live.chartSnr', { max: ymax })} <span className="key el" /> {t('live.chartEl')}
        <span className="key sync" /> {t('live.chartSync')} <span className="key nosync" /> {t('live.chartNoSync')}
        <span className="chart-times">{utcClock(start)}–{utcClock(end)} UTC</span>
      </p>}
      {!bare && syncKnown && (
        <p className="hint">
          {ends ? <>{t('sync.first', syncPlace(ends.first))} · {t('sync.last', syncPlace(ends.last))}</> : t('sync.none')}
        </p>
      )}
    </>
  )
}
