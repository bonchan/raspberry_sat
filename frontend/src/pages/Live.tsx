import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, satdumpImage, type Live as LiveData, type LiveSample, type UpcomingPass } from '../api'
import { useNow, usePolling, useTick } from '../hooks'
import { clock, size, utcClock } from '../format'
import { useT, type Key } from '../i18n'
import PassCards from '../PassCards'
import SignalChart from '../SignalChart'
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
  const t = useT()
  const { data: status } = usePolling(api.getStatus, 1000)
  const { data: schedule } = usePolling(api.getSchedule, 60000)
  const { live, samples } = useLive()
  const now = useNow()

  if (!status || !live) return <section><p className="hint">{t('common.loading')}</p></section>

  const tracker = status.tracker?.object_tracker
  const passes = schedule?.passes ?? []
  const current = passes.find(p => p.aos - 60 <= now && now <= p.los + 60)
  const next = passes.find(p => p.scheduled && p.aos > now)

  if (live.receiving && tracker) {
    const aos = current?.aos ?? live.pass_started
    const los = current?.los ?? tracker.next_los_time
    return (
      <>
        <section>
          <h2>{t('live.receiving', { name: tracker.object_name })}</h2>
          <PassCards aos={aos} los={los} inPass />
          <Progress aos={aos} los={los} now={now} />
        </section>
        <div className="live-grid">
          <section>
            <h2>{t('live.sky')}</h2>
            <SkyPlot track={current?.track} current={tracker.sat_current_pos} />
            <p className="hint center">
              az {tracker.sat_current_pos.az.toFixed(0)}°, el {tracker.sat_current_pos.el.toFixed(0)}°
              {tracker.sat_current_range !== undefined && `, ${Math.round(tracker.sat_current_range)} km`}
            </p>
            <SkyLegend />
          </section>
          <section>
            <h2>{t('live.signal')}</h2>
            <SignalTiles sample={samples[samples.length - 1]} caduBytes={live.cadu_bytes}
              frequency={status.tracker?.frequency} />
          </section>
        </div>
        <section>
          <h2>{t('live.thisPass')}</h2>
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
        <section>
          <p className="error">
            {t('live.notRunning', { state: t(`state.${status.satdump.state}` as Key) })} <Link to="/status">→</Link>
          </p>
        </section>
      )}
      {status.overhead && tracker && (
        <section>
          <h2>{t('live.overheadTitle', { name: tracker.object_name })}</h2>
          <p className="hint">
            {t('live.overheadHint', { peak: current ? t('live.peak', { el: Math.round(current.max_el) }) : '' })}
          </p>
          <div className="narrow">
            <SkyPlot track={current?.track} current={tracker.sat_current_pos} />
            <SkyLegend />
          </div>
        </section>
      )}
      {recent && (
        <section>
          <h2>{t('live.lastPass')}</h2>
          <p>
            {t('live.ended', { local: clock(live.last_los), utc: utcClock(live.last_los) })}{' '}
            {live.folder ? t('live.decoding') : <Link to="/passes">{t('live.seeInPasses')}</Link>}
          </p>
          <SignalChart samples={samples} start={live.pass_started} end={live.last_los} />
        </section>
      )}
      <NextPass next={next} />
    </>
  )
}

function NextPass({ next }: { next?: UpcomingPass }) {
  const t = useT()
  if (!next) return <section><h2>{t('live.nextPass')}</h2><p className="hint">{t('live.noNext')}</p></section>
  return (
    <section>
      <h2>{t('live.nextPass')} · {next.name}</h2>
      <PassCards aos={next.aos} los={next.los} inPass={false} />
      <p className="hint">
        {t('live.nextDetail', { min: Math.round((next.los - next.aos) / 60), el: Math.round(next.max_el) })}
      </p>
      <div className="narrow">
        <SkyPlot track={next.track} />
        <SkyLegend />
      </div>
      <p className="hint">{t('live.switches')}</p>
    </section>
  )
}

/** How far through the pass we are; the cards above carry the times. */
function Progress({ aos, los, now }: { aos: number; los: number; now: number }) {
  const share = Math.min(1, Math.max(0, (now - aos) / Math.max(1, los - aos)))
  return <div className="progress"><div style={{ width: `${share * 100}%` }} /></div>
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
  const t = useT()
  const s = sample ?? { t: 0 }
  const waiting = '…'
  return (
    <>
      <div className="tiles">
        <Tile label="SNR" value={s.snr !== undefined ? `${s.snr.toFixed(1)} dB` : waiting}
          sub={s.peak_snr !== undefined ? t('live.peakSnr', { v: s.peak_snr.toFixed(1) }) : undefined}
          tone={s.snr === undefined ? undefined : s.snr >= 4 ? 'ok' : s.snr >= 2 ? 'warn' : 'bad'} />
        <Tile label="Viterbi"
          value={s.viterbi_lock === undefined ? waiting : s.viterbi_lock ? t('live.locked') : t('live.searching')}
          sub={s.viterbi_ber !== undefined ? `BER ${s.viterbi_ber.toFixed(3)}` : undefined}
          tone={s.viterbi_lock === undefined ? undefined : s.viterbi_lock ? 'ok' : 'bad'} />
        <Tile label={t('live.deframer')}
          value={s.deframer_lock === undefined ? waiting : s.deframer_lock ? t('live.synced') : t('live.noSync')}
          tone={s.deframer_lock === undefined ? undefined : s.deframer_lock ? 'ok' : 'bad'} />
        <Tile label="Reed-Solomon"
          value={s.rs_avg === undefined ? waiting : s.rs_avg >= 0 ? t('live.rsFixed', { n: s.rs_avg }) : t('live.rsFailing')}
          sub={t('live.rsHint')}
          tone={s.rs_avg === undefined ? undefined : s.rs_avg >= 0 ? 'ok' : 'bad'} />
        <Tile label={t('live.frames')} value={String(Math.floor(caduBytes / FRAME_BYTES))} sub={size(caduBytes)}
          tone={caduBytes > 0 ? 'ok' : undefined} />
        <Tile label={t('live.freqOffset')} value={s.freq !== undefined ? `${Math.round(s.freq)} Hz` : waiting}
          sub={frequency ? t('live.tuned', { f: (frequency / 1e6).toFixed(3) }) : undefined} />
      </div>
      {sample === undefined && <p className="hint">{t('live.waitingDemod')}</p>}
    </>
  )
}

function Spectrum() {
  const t = useT()
  const tick = useTick(1000)
  return (
    <section>
      <h2>{t('live.spectrum')}</h2>
      <img className="fft" src={satdumpImage('fft', tick)} alt={t('live.spectrum')} />
    </section>
  )
}
