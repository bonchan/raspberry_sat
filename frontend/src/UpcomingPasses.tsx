import { useState, type ReactNode } from 'react'
import { api, type UpcomingPass } from './api'
import { useNow, usePolling } from './hooks'
import { clock, compass, duration, sameDay, utcClock, weekdayAndDay } from './format'
import { useT } from './i18n'
import SkyPlot, { SkyLegend } from './SkyPlot'

// how good a pass is, from its highest elevation
export const GOOD = 30
export const EXCELLENT = 60
type Quality = 'low' | 'fair' | 'good' | 'excellent'

/** for a pass high enough to be recorded; also colours received passes */
export function elevationQuality(maxEl: number): Exclude<Quality, 'low'> {
  return maxEl >= EXCELLENT ? 'excellent' : maxEl >= GOOD ? 'good' : 'fair'
}

function quality(p: UpcomingPass): Quality {
  return p.scheduled ? elevationQuality(p.max_el) : 'low'
}

interface Props { minElevation?: number; station?: string; showLow?: boolean }

export default function UpcomingPasses({ minElevation, station, showLow = true }: Props) {
  const t = useT()
  const { data, error } = usePolling(api.getSchedule, 60000)
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)

  const days = data?.days ?? 1
  const span = days === 1 ? t('up.oneDay') : t('up.manyDays', { n: days })
  const all = data?.passes ?? []
  const passes = showLow ? all : all.filter(p => p.scheduled)
  const key = (p: UpcomingPass) => `${p.norad}-${p.aos}`
  const shown = passes.find(p => key(p) === selected) ?? passes.find(p => p.scheduled) ?? passes[0]

  const rows: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    const label = sameDay(p.aos, now) ? t('up.today') : weekdayAndDay(p.aos)
    if (label !== day) {
      day = label
      rows.push(<tr key={`day-${label}`} className="day"><td colSpan={5}>{label}</td></tr>)
    }
    const q = quality(p)
    const live = p.aos <= now && now <= p.los
    rows.push(
      <tr key={key(p)} className={[`q-${q}`, shown === p && 'on', live && 'live'].filter(Boolean).join(' ')}
        onClick={() => setSelected(key(p))}>
        <td>{p.name}</td>
        <td>
          {clock(p.aos)} <span className="hint">{utcClock(p.aos)} UTC</span>
          <div className="hint">{live ? t('up.now') : t('common.in', { d: duration(p.aos - now) })}</div>
        </td>
        <td>{Math.round((p.los - p.aos) / 60)} min</td>
        <td>{Math.round(p.max_el)}°</td>
        <td>{compass(p.aos_az)} → {compass(p.los_az)}</td>
      </tr>,
    )
  }

  return (
    <section>
      <h2>{station ? t('up.titleAt', { station, span }) : t('up.title', { span })}</h2>
      {error && <p className="error">{error}</p>}
      {data?.error && <p className="hint">{data.error}</p>}
      {data?.missing?.length ? <p className="hint">{t('up.missing', { list: data.missing.join(', ') })}</p> : null}
      {data && !data.error && passes.length === 0 && <p className="hint">{t('up.none')}</p>}
      {passes.length > 0 && (
        <div className="upcoming">
          <div className="upcoming-sky">
            <SkyPlot track={shown?.track} minElevation={minElevation} />
            {shown && <p className="hint center">{shown.name}, {clock(shown.aos)} ({utcClock(shown.aos)} UTC)</p>}
            <SkyLegend />
          </div>
          <table className="passes">
            <thead>
              <tr>
                <th>{t('up.satellite')}</th><th>{t('up.starts')}</th><th>{t('up.length')}</th>
                <th>{t('up.maxEl')}</th><th>{t('up.direction')}</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      )}
      <p className="hint quality-legend">
        {t('up.qualityLegend')}
        <span className="swatch q-fair" />{t('quality.fair')} &lt; {GOOD}°
        <span className="swatch q-good" />{t('quality.good')} {GOOD}–{EXCELLENT}°
        <span className="swatch q-excellent" />{t('quality.excellent')} ≥ {EXCELLENT}°
        {showLow && <><span className="swatch q-low" />{t('quality.low')}</>}
      </p>
      {showLow && <p className="hint">{t('up.lowHint')}</p>}
    </section>
  )
}
