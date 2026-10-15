import { useState, type ReactNode } from 'react'
import { api, type UpcomingPass } from './api'
import { useNow, usePolling } from './hooks'
import { clock, compass, duration, utcClock } from './format'
import SkyPlot, { SkyLegend } from './SkyPlot'

// how good a pass is, from its highest elevation
const GOOD = 30
const EXCELLENT = 60
type Quality = 'low' | 'fair' | 'good' | 'excellent'

function quality(p: UpcomingPass): Quality {
  if (!p.scheduled) return 'low'
  return p.max_el >= EXCELLENT ? 'excellent' : p.max_el >= GOOD ? 'good' : 'fair'
}

const QUALITY_LABEL: Record<Quality, string> = { low: 'too low', fair: 'fair', good: 'good', excellent: 'excellent' }

/** "Today", or "Wednesday 14", in local time */
function dayLabel(unix: number, now: number): string {
  const d = new Date(unix * 1000)
  if (d.toDateString() === new Date(now * 1000).toDateString()) return 'Today'
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getDate()}`
}

interface Props { minElevation?: number; station?: string; showLow?: boolean }

export default function UpcomingPasses({ minElevation, station, showLow = true }: Props) {
  const { data, error } = usePolling(api.getSchedule, 60000)
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)

  const all = data?.passes ?? []
  const passes = showLow ? all : all.filter(p => p.scheduled)
  const key = (p: UpcomingPass) => `${p.norad}-${p.aos}`
  const shown = passes.find(p => key(p) === selected) ?? passes.find(p => p.scheduled) ?? passes[0]

  const rows: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    const label = dayLabel(p.aos, now)
    if (label !== day) {
      day = label
      rows.push(<tr key={`day-${label}`} className="day"><td colSpan={6}>{label}</td></tr>)
    }
    const q = quality(p)
    const live = p.aos <= now && now <= p.los
    rows.push(
      <tr key={key(p)} className={[`q-${q}`, shown === p && 'on', live && 'live'].filter(Boolean).join(' ')}
        onClick={() => setSelected(key(p))}>
        <td>{p.name}</td>
        <td>
          {clock(p.aos)} <span className="hint">{utcClock(p.aos)} UTC</span>
          <div className="hint">{live ? 'now' : `in ${duration(p.aos - now)}`}</div>
        </td>
        <td>{Math.round((p.los - p.aos) / 60)} min</td>
        <td>{Math.round(p.max_el)}°</td>
        <td>{compass(p.aos_az)} → {compass(p.los_az)}</td>
        <td><span className={`quality q-${q}`}>{QUALITY_LABEL[q]}</span></td>
      </tr>,
    )
  }

  return (
    <section>
      <h2>Upcoming passes{station && ` at ${station}`} (24 h)</h2>
      {error && <p className="error">{error}</p>}
      {data?.error && <p className="hint">{data.error}</p>}
      {data?.missing?.length ? <p className="hint">No orbit data for: {data.missing.join(', ')}.</p> : null}
      {data && !data.error && passes.length === 0 && <p className="hint">No passes in the next 24 hours.</p>}
      {passes.length > 0 && (
        <div className="upcoming">
          <div>
            <SkyPlot track={shown?.track} minElevation={minElevation} />
            {shown && <p className="hint center">{shown.name}, {clock(shown.aos)} ({utcClock(shown.aos)} UTC)</p>}
            <SkyLegend />
          </div>
          <table className="passes">
            <thead>
              <tr><th>Satellite</th><th>Starts</th><th>Length</th><th>Max el.</th><th>Direction</th><th>Quality</th></tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Quality by highest elevation: fair under {GOOD}°, good {GOOD}–{EXCELLENT}°, excellent above {EXCELLENT}°.
        {showLow && ' Passes marked "too low" stay under the minimum elevation, so SatDump skips them.'}
      </p>
    </section>
  )
}
