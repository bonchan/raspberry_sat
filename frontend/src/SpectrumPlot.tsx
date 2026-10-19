// SatDump's spectrum drawn here from the numbers /api/spectrum reads back out of its picture: the trace
// with a frequency axis and the downlink band marked, and a waterfall of the last half minute under it.

import { useEffect, useRef } from 'react'
import { api } from './api'
import { usePolling, useVisible } from './hooks'
import { useT } from './i18n'

const W = 512, PLOT_H = 200, AXIS_H = 22
const ROWS = 120                // waterfall rows, one per reading: 30 s at four a second
const BAND = 60_000             // Hz each side of the tuned frequency: Meteor LRPT is about 120 kHz wide
const TICK = 100_000            // Hz between frequency labels

interface Range { lo: number; hi: number }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

// black → blue → cyan → yellow → white, for 0..1
const STOPS = [[0, 0, 0], [20, 40, 140], [0, 170, 230], [250, 220, 60], [255, 255, 255]]
function heat(x: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, x)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(f)), k = f - i
  const [a, b] = [STOPS[i], STOPS[i + 1]]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** Polls four times a second while the page is on screen; nothing while hidden. */
export default function SpectrumPlot() {
  const t = useT()
  const visible = useVisible()
  const { data, error } = usePolling(api.getSpectrum, 250, visible)
  const range = useRef<Range | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  const values = data ? data.db.map(v => v ?? data.min) : []
  const floor = median(values)
  const peak = Math.max(...values, floor)

  // the dB scale moves only when the trace leaves it, so it doesn't jitter from one reading to the next
  if (values.length && (!range.current || peak > range.current.hi - 1 || floor < range.current.lo + 3 ||
                        floor > range.current.lo + 25)) {
    const lo = Math.floor((floor - 10) / 10) * 10
    range.current = { lo, hi: Math.max(lo + 40, Math.ceil((peak + 4) / 10) * 10) }
  }
  const { lo, hi } = range.current ?? { lo: -100, hi: -40 }

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !data) return
    ctx.drawImage(ctx.canvas, 0, 0, W, ROWS - 1, 0, 1, W, ROWS - 1)      // older rows move down
    const row = ctx.createImageData(W, 1)
    data.db.forEach((v, i) => {
      const [r, g, b] = heat(((v ?? data.min) - lo) / (hi - lo))
      row.data.set([r, g, b, 255], i * 4)
    })
    ctx.putImageData(row, 0, 0)
  }, [data])     // one row per reading; the colours use the scale of the moment

  if (!data) return <p className="hint">{error ? t('live.noSpectrum') : t('common.loading')}</p>

  const y = (db: number) => (hi - Math.min(hi, Math.max(lo, db))) / (hi - lo) * PLOT_H
  const x = (offsetHz: number) => (0.5 + offsetHz / data.samplerate) * W
  const trace = values.map((v, i) => `${(i + 0.5) * W / values.length},${y(v).toFixed(1)}`).join(' ')
  const inBand = values.filter((_, i) => Math.abs((i + 0.5) / values.length - 0.5) * data.samplerate < BAND * 0.8)
  const band = median(inBand)
  const ticks: number[] = []
  for (let k = -Math.floor(data.samplerate / 2 / TICK); k * TICK <= data.samplerate / 2; k++) ticks.push(k * TICK)
  const grid: number[] = []
  for (let db = lo + 10; db < hi; db += 10) grid.push(db)

  return (
    <div className="spectrum">
      <svg viewBox={`0 0 ${W} ${PLOT_H + AXIS_H}`} role="img" aria-label={t('live.spectrum')}>
        <rect className="spectrum-band" x={x(-BAND)} y={0} width={x(BAND) - x(-BAND)} height={PLOT_H} />
        <text className="spectrum-label" x={x(0)} y={12} textAnchor="middle">LRPT</text>
        {grid.map(db => (
          <g key={db}>
            <line className="spectrum-grid" x1={0} x2={W} y1={y(db)} y2={y(db)} />
            <text className="spectrum-label" x={3} y={y(db) - 3}>{db} dB</text>
          </g>
        ))}
        <polygon className="spectrum-fill" points={`0,${PLOT_H} ${trace} ${W},${PLOT_H}`} />
        <polyline className="spectrum-trace" points={trace} />
        <line className="spectrum-grid" x1={0} x2={W} y1={PLOT_H} y2={PLOT_H} />
        {data.frequency !== null && ticks.map(f => (
          <text key={f} className={f === 0 ? 'spectrum-label center' : 'spectrum-label'}
            x={x(f)} y={PLOT_H + 15} textAnchor="middle">
            {((data.frequency! + f) / 1e6).toFixed(1)}
          </text>
        ))}
      </svg>
      <canvas ref={canvas} className="waterfall" width={W} height={ROWS} />
      <p className="hint">
        {t('spectrum.floor', { v: floor.toFixed(0) })} · {t('spectrum.band', { v: band.toFixed(0) })}
        {' '}(<b className={band - floor >= 6 ? 'ok' : band - floor >= 3 ? 'caution' : ''}>
          {t('spectrum.above', { v: (band - floor).toFixed(1) })}</b>)
        {data.frequency !== null && <> · {t('live.tuned', { f: (data.frequency / 1e6).toFixed(3) })}</>}
        {' '}· {t('spectrum.waterfall', { s: ROWS / 4 })}
      </p>
    </div>
  )
}
