// A pass's signal over time, drawn as on the Pi (its drawing is shared: frontend/src/signalPlot.ts): SNR, the
// predicted elevation behind it, and a strip that is green while frames sync.

import { PLOT, signalPlot } from '../../../frontend/src/signalPlot'
import type { SignalThumb } from './api'
import { utc } from './format'
import { useT } from './i18n'

/** bare: the chart alone (the pass list); otherwise with its legend (the pass page) */
export default function SignalChart({ signal, bare = false }: { signal: SignalThumb; bare?: boolean }) {
  const t = useT()
  const plot = signalPlot(signal.samples, signal.start, signal.end, signal.track ?? undefined)
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
      {!bare && (
        <p className="hint chart-legend">
          <span className="key snr" /> {t('chart.snr', { max: plot.ymax })} <span className="key el" /> {t('chart.el')}
          <span className="key sync" /> {t('chart.sync')} <span className="key nosync" /> {t('chart.noSync')}
          <span className="chart-times">{utc(signal.start)} – {utc(signal.end).slice(11)}</span>
        </p>
      )}
    </>
  )
}
