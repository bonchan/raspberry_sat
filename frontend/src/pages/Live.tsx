import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, satdumpImage, type Live as LiveData, type LiveSample, type UpcomingPass } from '../api'
import { useNow, usePolling, useTick } from '../hooks'
import { clock, duration, size, utcClock } from '../format'
import SkyPlot, { SkyLegend } from '../SkyPlot'

const FRAME_BYTES = 1024            // one Meteor LRPT frame (CADU) in SatDump's .cadu file

/** The live endpoint, polled every second; samples accumulate, and start over when a new pass begins. */
function useLive() {
  const [live, setLive] = useState<LiveData | null>(null)
  const [samples, setSamples] = useState<LiveSample[]>([])
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let last = 0
    let started = -1
    async function poll() {
      try {
        const r = await api.getLive(last)
        if (!alive) return
        if (r.pass_started !== started) {
          started = r.pass_started
          setSamples(r.history)
        } else if (r.history.length) {
          setSamples(prev => [...prev, ...r.history])
        }
        if (r.history.length) last = r.history[r.history.length - 1].t
        setLive(r)
      } catch { /* backend restarting */ }
      if (alive) timer = window.setTimeout(poll, 1000)
    }
    poll()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])
  return { live, samples }
}

export default function Live() {
  const { data: status } = usePolling(api.getStatus, 1000)
  const { data: schedule } = usePolling(api.getSchedule, 60000)
  const { live, samples } = useLive()
  const now = useNow()

  if (!status || !live) return <section><p className="hint">Loading…</p></section>

  const tracker = status.tracker?.object_tracker
  const passes = schedule?.passes ?? []
  const current = passes.find(p => p.aos - 60 <= now && now <= p.los + 60)
  const next = passes.find(p => p.scheduled && p.aos > now)

  if (live.in_pass && tracker) {
    const aos = current?.aos ?? live.pass_started
    const los = current?.los ?? tracker.next_los_time
    return (
      <>
        <section>
          <h2>Receiving {tracker.object_name}</h2>
          <Progress aos={aos} los={los} now={now} />
        </section>
        <div className="live-grid">
          <section>
            <h2>Sky</h2>
            <SkyPlot track={current?.track} current={tracker.sat_current_pos} />
            <p className="hint center">
              az {tracker.sat_current_pos.az.toFixed(0)}°, el {tracker.sat_current_pos.el.toFixed(0)}°
              {tracker.sat_current_range !== undefined && `, ${Math.round(tracker.sat_current_range)} km`}
            </p>
            <SkyLegend />
          </section>
          <section>
            <h2>Signal</h2>
            <SignalTiles sample={samples[samples.length - 1]} caduBytes={live.cadu_bytes}
              frequency={status.tracker?.frequency} />
          </section>
        </div>
        <section>
          <h2>This pass</h2>
          <SignalChart samples={samples} start={aos} end={los} track={current?.track} />
        </section>
        <Spectrum />
      </>
    )
  }

  const recent = live.last_los > 0 && now - live.last_los < 3600 && samples.length > 0
  return (
    <>
      {status.satdump.state !== 'running' && (
        <section><p className="error">SatDump is not running ({status.satdump.state}). See Status.</p></section>
      )}
      {recent && (
        <section>
          <h2>Last pass</h2>
          <p>
            Ended at {clock(live.last_los)} ({utcClock(live.last_los)} UTC).{' '}
            {live.folder
              ? 'SatDump is decoding it; the images appear in Passes about 5 minutes after it finishes.'
              : <Link to="/passes">See it in Passes →</Link>}
          </p>
          <SignalChart samples={samples} start={live.pass_started} end={live.last_los} />
        </section>
      )}
      <NextPass next={next} now={now} />
    </>
  )
}

function NextPass({ next, now }: { next?: UpcomingPass; now: number }) {
  if (!next) return <section><h2>Next pass</h2><p className="hint">No pass high enough in the next 24 hours.</p></section>
  return (
    <section>
      <h2>Next pass</h2>
      <p>
        <b>{next.name}</b> in {duration(next.aos - now)}: {clock(next.aos)} ({utcClock(next.aos)} UTC),
        {' '}{Math.round((next.los - next.aos) / 60)} min, up to {Math.round(next.max_el)}°.
      </p>
      <div className="narrow">
        <SkyPlot track={next.track} />
        <SkyLegend />
      </div>
      <p className="hint">This page switches to the live view when the pass starts.</p>
    </section>
  )
}

function Progress({ aos, los, now }: { aos: number; los: number; now: number }) {
  const share = Math.min(1, Math.max(0, (now - aos) / Math.max(1, los - aos)))
  return (
    <>
      <div className="progress"><div style={{ width: `${share * 100}%` }} /></div>
      <div className="progress-labels">
        <span>AOS {utcClock(aos)} UTC</span>
        <span>{duration(los - now)} left</span>
        <span>LOS {utcClock(los)} UTC</span>
      </div>
    </>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function SignalTiles({ sample, caduBytes, frequency }: { sample?: LiveSample; caduBytes: number; frequency?: number }) {
  const s = sample ?? { t: 0 }
  const waiting = '…'
  return (
    <>
      <div className="tiles">
        <Tile label="SNR" value={s.snr !== undefined ? `${s.snr.toFixed(1)} dB` : waiting}
          sub={s.peak_snr !== undefined ? `peak ${s.peak_snr.toFixed(1)} dB` : undefined}
          tone={s.snr === undefined ? undefined : s.snr >= 4 ? 'ok' : s.snr >= 2 ? 'warn' : 'bad'} />
        <Tile label="Viterbi" value={s.viterbi_lock === undefined ? waiting : s.viterbi_lock ? 'locked' : 'searching'}
          sub={s.viterbi_ber !== undefined ? `BER ${s.viterbi_ber.toFixed(3)}` : undefined}
          tone={s.viterbi_lock === undefined ? undefined : s.viterbi_lock ? 'ok' : 'bad'} />
        <Tile label="Deframer" value={s.deframer_lock === undefined ? waiting : s.deframer_lock ? 'synced' : 'no sync'}
          tone={s.deframer_lock === undefined ? undefined : s.deframer_lock ? 'ok' : 'bad'} />
        <Tile label="Reed-Solomon" value={s.rs_avg === undefined ? waiting : s.rs_avg >= 0 ? `${s.rs_avg} fixed` : 'failing'}
          sub="average corrections per frame"
          tone={s.rs_avg === undefined ? undefined : s.rs_avg >= 0 ? 'ok' : 'bad'} />
        <Tile label="Frames" value={String(Math.floor(caduBytes / FRAME_BYTES))} sub={size(caduBytes)}
          tone={caduBytes > 0 ? 'ok' : undefined} />
        <Tile label="Frequency offset" value={s.freq !== undefined ? `${Math.round(s.freq)} Hz` : waiting}
          sub={frequency ? `tuned ${(frequency / 1e6).toFixed(3)} MHz` : undefined} />
      </div>
      {sample === undefined && <p className="hint">Waiting for SatDump's demodulator to report.</p>}
    </>
  )
}

/** SNR over the pass, the predicted elevation behind it, and a strip that is green while frames sync. */
function SignalChart({ samples, start, end, track }: {
  samples: LiveSample[]; start: number; end: number; track?: [number, number][]
}) {
  const W = 600, H = 170, TOP = 6, BOTTOM = 146, STRIP = 152
  const x = (t: number) => ((t - start) / Math.max(1, end - start)) * W
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
        <span className="key snr" /> SNR (0–{ymax} dB) <span className="key el" /> elevation (0–90°)
        <span className="key sync" /> frames syncing <span className="key nosync" /> no sync
        <span className="chart-times">{utcClock(start)}–{utcClock(end)} UTC</span>
      </p>
    </>
  )
}

function Spectrum() {
  const tick = useTick(1000)
  return (
    <section>
      <h2>Spectrum</h2>
      <img className="fft" src={satdumpImage('fft', tick)} alt="Live spectrum from SatDump" />
    </section>
  )
}
