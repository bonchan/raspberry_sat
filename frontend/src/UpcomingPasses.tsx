import { useState } from 'react'
import { api, type UpcomingPass } from './api'
import { useNow, usePolling } from './hooks'
import { clock, compass, duration, utcClock } from './format'
import SkyPlot, { SkyLegend } from './SkyPlot'

export default function UpcomingPasses({ minElevation, station }: { minElevation?: number; station?: string }) {
  const { data, error } = usePolling(api.getSchedule, 60000)
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)

  const passes = data?.passes ?? []
  const key = (p: UpcomingPass) => `${p.norad}-${p.aos}`
  const shown = passes.find(p => key(p) === selected) ?? passes.find(p => p.scheduled) ?? passes[0]

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
              <tr><th>Satellite</th><th>Starts</th><th>Length</th><th>Max el.</th><th>Direction</th><th></th></tr>
            </thead>
            <tbody>
              {passes.map(p => {
                const live = p.aos <= now && now <= p.los
                return (
                  <tr key={key(p)} className={[shown === p && 'on', !p.scheduled && 'low', live && 'live'].filter(Boolean).join(' ')}
                    onClick={() => setSelected(key(p))}>
                    <td>{p.name}</td>
                    <td>
                      {clock(p.aos)} <span className="hint">{utcClock(p.aos)} UTC</span>
                      <div className="hint">{live ? 'now' : `in ${duration(p.aos - now)}`}</div>
                    </td>
                    <td>{Math.round((p.los - p.aos) / 60)} min</td>
                    <td>{Math.round(p.max_el)}°</td>
                    <td>{compass(p.aos_az)} → {compass(p.los_az)}</td>
                    <td className="hint">{p.scheduled ? '' : 'too low'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Passes marked "too low" stay under the minimum elevation, so SatDump skips them.</p>
    </section>
  )
}
