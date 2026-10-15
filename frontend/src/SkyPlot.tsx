// The sky seen from the station: centre is straight up, the outer ring is the horizon, north at the top.

import { useT } from './i18n'

const C = 150, R = 118

export function skyXY(az: number, el: number): [number, number] {
  const r = (R * (90 - Math.max(0, Math.min(90, el)))) / 90
  const a = (az * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

interface Props {
  track?: [number, number][]           // [az, el] from AOS to LOS
  current?: { az: number; el: number } | null
  minElevation?: number                 // dashed ring: passes must climb above it to be recorded
}

export default function SkyPlot({ track, current, minElevation }: Props) {
  const t = useT()
  const points = track?.map(([az, el]) => skyXY(az, el).join(',')).join(' ')
  const aos = track?.length ? skyXY(...track[0]) : null
  const los = track?.length ? skyXY(...track[track.length - 1]) : null
  const sat = current && current.el > 0 ? skyXY(current.az, current.el) : null

  return (
    <svg className="sky" viewBox="0 0 300 300" role="img" aria-label={t('sky.label')}>
      {[0, 30, 60].map(el => (
        <circle key={el} className="sky-ring" cx={C} cy={C} r={(R * (90 - el)) / 90} />
      ))}
      {minElevation !== undefined && minElevation > 0 && (
        <circle className="sky-min" cx={C} cy={C} r={(R * (90 - minElevation)) / 90} />
      )}
      <line className="sky-ring" x1={C} y1={C - R} x2={C} y2={C + R} />
      <line className="sky-ring" x1={C - R} y1={C} x2={C + R} y2={C} />
      <text className="sky-label" x={C + 3} y={C - (R * 60) / 90 - 3}>30°</text>
      <text className="sky-label" x={C + 3} y={C - (R * 30) / 90 - 3}>60°</text>
      <text className="sky-dir" x={C} y={C - R - 8} textAnchor="middle">{t('sky.n')}</text>
      <text className="sky-dir" x={C + R + 10} y={C + 5} textAnchor="middle">{t('sky.e')}</text>
      <text className="sky-dir" x={C} y={C + R + 20} textAnchor="middle">{t('sky.s')}</text>
      <text className="sky-dir" x={C - R - 10} y={C + 5} textAnchor="middle">{t('sky.w')}</text>

      {points && <polyline className="sky-track" points={points} />}
      {aos && <circle className="sky-aos" cx={aos[0]} cy={aos[1]} r={5} />}
      {los && <rect className="sky-los" x={los[0] - 4.5} y={los[1] - 4.5} width={9} height={9} />}
      {sat && <circle className="sky-sat" cx={sat[0]} cy={sat[1]} r={7} />}
    </svg>
  )
}

export function SkyLegend() {
  const t = useT()
  return (
    <p className="sky-legend hint">
      <span className="dot aos" /> {t('sky.rises')} <span className="dot los" /> {t('sky.sets')}
      <span className="dot sat" /> {t('sky.satNow')} <span className="dash" /> {t('sky.minEl')}
    </p>
  )
}
