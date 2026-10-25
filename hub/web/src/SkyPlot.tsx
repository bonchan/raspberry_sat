// The sky seen from the station during the pass, drawn as on the Pi (the drawing is shared:
// frontend/src/skyGeometry.ts): the track from where it rose to where it set, green while frames synced, red
// while not. The hub's signal has no azimuth per sample, so each is placed at the track's point for its time.

import { SKY, skyRing, skyTrack, syncRuns, type SkySample } from '../../../frontend/src/skyGeometry'
import type { SignalThumb } from './api'

/** The samples on the sky: each at the track point nearest its time (the track spans start to end evenly). */
function placed(signal: SignalThumb | null, track: [number, number][]): SkySample[] {
  if (!signal || track.length < 2) return []
  const span = Math.max(1, signal.end - signal.start)
  return signal.samples.map(s => {
    const i = Math.round(((s.t - signal.start) / span) * (track.length - 1))
    const [az, el] = track[Math.max(0, Math.min(track.length - 1, i))]
    return { az, el, deframer_lock: s.deframer_lock }
  })
}

export default function SkyPlot({ track, signal }: { track: [number, number][]; signal: SignalThumb | null }) {
  const { C, R } = SKY
  const runs = syncRuns(placed(signal, track))
  const { points, aos, los } = skyTrack(track)
  return (
    <>
      <svg className="sky" viewBox="0 0 300 300" role="img" aria-label="The pass across the sky">
        {[0, 30, 60].map(el => <circle key={el} className="sky-ring" cx={C} cy={C} r={skyRing(el)} />)}
        <line className="sky-ring" x1={C} y1={C - R} x2={C} y2={C + R} />
        <line className="sky-ring" x1={C - R} y1={C} x2={C + R} y2={C} />
        <text className="sky-label" x={C + 3} y={C - skyRing(30) - 3}>30°</text>
        <text className="sky-label" x={C + 3} y={C - skyRing(60) - 3}>60°</text>
        <text className="sky-dir" x={C} y={C - R - 8} textAnchor="middle">N</text>
        <text className="sky-dir" x={C + R + 10} y={C + 5} textAnchor="middle">E</text>
        <text className="sky-dir" x={C} y={C + R + 20} textAnchor="middle">S</text>
        <text className="sky-dir" x={C - R - 10} y={C + 5} textAnchor="middle">W</text>
        {points && <polyline className="sky-track" points={points} />}
        {runs.map((r, i) => <polyline key={i} className={r.synced ? 'sky-sync' : 'sky-nosync'} points={r.points} />)}
        {aos && <circle className="sky-aos" cx={aos[0]} cy={aos[1]} r={5} />}
        {los && <rect className="sky-los" x={los[0] - 4.5} y={los[1] - 4.5} width={9} height={9} />}
      </svg>
      <p className="sky-legend hint">
        <span className="dot aos" /> rises <span className="dot los" /> sets
        {runs.length > 0 && <><span className="line sync" /> frames sync <span className="line nosync" /> no sync</>}
      </p>
    </>
  )
}
