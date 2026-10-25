// The drawing of the sky seen from a station, shared by SkyPlot.tsx on the Pi and the hub's
// (hub/web/src/SkyPlot.tsx): centre is straight up, the outer ring is the horizon, north at the top. Plain
// TypeScript, no React, so the hub can import it as it is.

/** the plot's own coordinates: the SVG's viewBox is 300 x 300 */
export const SKY = { C: 150, R: 118 }

export function skyXY(az: number, el: number): [number, number] {
  const r = (SKY.R * (90 - Math.max(0, Math.min(90, el)))) / 90
  const a = (az * Math.PI) / 180
  return [SKY.C + r * Math.sin(a), SKY.C - r * Math.cos(a)]
}

/** radius of the ring at elevation `el` */
export const skyRing = (el: number) => (SKY.R * (90 - el)) / 90

/** what the painting of the track needs of a sample (LiveSample on the Pi) */
export interface SkySample { az?: number | null; el?: number | null; deframer_lock?: boolean }

/** Runs of samples with the same sync state as polylines (green while frames sync, red while not); each run
    ends where the next starts, so they join. */
export function syncRuns(samples: SkySample[]): { synced: boolean; points: string }[] {
  const runs: { synced: boolean; points: string[] }[] = []
  for (const s of samples) {
    if (s.deframer_lock === undefined || s.az == null || s.el == null) continue
    const point = skyXY(s.az, s.el).join(',')
    const last = runs[runs.length - 1]
    if (last?.synced === s.deframer_lock) {
      last.points.push(point)
    } else {
      last?.points.push(point)
      runs.push({ synced: s.deframer_lock, points: [point] })
    }
  }
  return runs.filter(r => r.points.length > 1).map(r => ({ synced: r.synced, points: r.points.join(' ') }))
}

/** the track ([az, el] from AOS to LOS) as polyline points, and where it rises and sets */
export function skyTrack(track: [number, number][] | undefined) {
  return {
    points: track?.map(([az, el]) => skyXY(az, el).join(',')).join(' '),
    aos: track?.length ? skyXY(...track[0]) : null,
    los: track?.length ? skyXY(...track[track.length - 1]) : null,
  }
}
