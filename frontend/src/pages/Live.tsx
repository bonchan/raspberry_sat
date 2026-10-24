import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LiveSample, LiveState, Processing, UpcomingPass } from '../api'
import { useNow, useVisible } from '../hooks'
import { clock, size, utcClock } from '../format'
import { useT, type Key } from '../i18n'
import Globe from '../Globe'
import PassCards from '../PassCards'
import SignalChart from '../SignalChart'
import SpectrumPlot from '../SpectrumPlot'
import SkyPlot, { SkyLegend } from '../SkyPlot'
import { subscribe, useTopic } from '../stream'

const FRAME_BYTES = 1024            // one Meteor LRPT frame (CADU) in SatDump's .cadu file

/** The topic "live": a snapshot with the samples so far, then the latest reading and a new sample a
    second; the samples start over when a new pass begins. Subscribed only while `enabled`. */
function useLive(enabled: boolean) {
  const [live, setLive] = useState<LiveState | null>(null)
  const [samples, setSamples] = useState<LiveSample[]>([])
  useEffect(() => {
    if (!enabled) return
    let started: number | null = null
    return subscribe('live', message => {
      if (message.kind === 'snapshot') {
        started = message.pass_started
        setSamples(message.history)
      } else {
        if (started === null) return                       // the snapshot comes first
        if (message.pass_started !== started) {
          started = message.pass_started
          setSamples(message.sample ? [message.sample] : [])
        } else if (message.sample) {
          setSamples(prev => [...prev, message.sample!])
        }
      }
      const { receiving, pass_started, last_los, current, folder, cadu_bytes } = message
      setLive({ receiving, pass_started, last_los, current, folder, cadu_bytes })
    })
  }, [enabled])
  return { live, samples }
}

export default function Live() {
  const t = useT()
  // while this page is on screen: four times a second during a pass or with the spectrum shown, once a second
  // for a low pass, otherwise only when something changes (the globe and the clocks run on their own)
  const visible = useVisible()
  const status = useTopic('status', visible)
  const schedule = useTopic('schedule')
  const config = useTopic('config')
  const { live, samples } = useLive(visible)
  const processing = useTopic('processing') ?? null
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
        <section>
          <h2>{t('live.signal')}</h2>
          <SignalTiles sample={live.current ?? samples[samples.length - 1]} caduBytes={live.cadu_bytes}
            frequency={status.tracker?.frequency} />
        </section>
        <div className="live-grid with-globe">
          <section>
            <h2>{t('live.sky')}</h2>
            <SkyPlot track={current?.track} current={tracker.sat_current_pos} samples={samples} />
            <p className="hint center">
              az {tracker.sat_current_pos.az.toFixed(0)}°, el {tracker.sat_current_pos.el.toFixed(0)}°
              {tracker.sat_current_range !== undefined && `, ${Math.round(tracker.sat_current_range)} km`}
            </p>
            <SkyLegend sync />
          </section>
          <GlobeSection highlight={current?.norad} fill cameraModes />
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
            {processing ? null : live.folder ? t('live.decoding') : <Link to="/passes">{t('live.seeInPasses')}</Link>}
          </p>
          {processing && <ProcessingBar processing={processing} />}
          <SignalChart samples={samples} start={live.pass_started} end={live.last_los} />
        </section>
      )}
      {!recent && processing && (
        <section>
          <h2>{t('live.processingTitle', { name: processing.satellite ?? processing.pass })}</h2>
          <ProcessingBar processing={processing} />
        </section>
      )}
      <NextPass next={next} />
      <GlobeSection order={nextOrder(passes, now)} cameraModes />
      {status.satdump.state === 'running' && config && (
        <IdleReceiver stopsWhenIdle={config.tracking.stop_sdr_when_idle} frequency={status.tracker?.frequency} />
      )}
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
      <p className="hint">{t('live.switches')}</p>
    </section>
  )
}

/** How far the last pass is after LOS: SatDump's own progress in the first step, an estimate while it
    makes the images (it says nothing then), the thumbnails counted. */
function ProcessingBar({ processing }: { processing: Processing }) {
  const t = useT()
  const p = processing.percent
  return (
    <div className="processing-block">
      <div className="processing-step">
        <span>{t(`processing.${processing.step}`)}</span>
        <b>{p === null ? '…' : `${p}%`}</b>
      </div>
      <div className="progress"><div style={{ width: `${p ?? 0}%` }} /></div>
      {processing.step === 'images' && <p className="hint">{t('processing.estimateHint')}</p>}
    </div>
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

/** The satellites in the settings on a globe, where they are now; the one being received in yellow. */
const LIVE_START_HEIGHT = 15_000_000     // metres above the station: the hemisphere around it

/** NORAD number -> 1, 2, 3... in the order of their next recorded pass */
function nextOrder(passes: UpcomingPass[], now: number): Record<number, number> {
  const order: Record<number, number> = {}
  let n = 0
  for (const p of passes) {
    if (p.scheduled && p.los > now && !(p.norad in order)) order[p.norad] = ++n
  }
  return order
}

/** The station and the enabled satellites, where they are now (pass images are on the Passes page).
    fill: as tall as the row it sits in (during a pass). cameraModes: follow/static buttons, click to aim. */
function GlobeSection({ highlight, fill = false, order, cameraModes = false }: {
  highlight?: number; fill?: boolean; order?: Record<number, number>; cameraModes?: boolean
}) {
  const t = useT()
  return (
    <section className={fill ? 'globe-section' : undefined}>
      <h2>{t('globe.title')}</h2>
      <Globe satellites highlight={highlight} size={fill ? 'fill' : 'tall'} startHeight={LIVE_START_HEIGHT}
        order={order} cameraModes={cameraModes} />
    </section>
  )
}

function Spectrum() {
  const t = useT()
  return (
    <section>
      <h2>{t('live.spectrum')}</h2>
      <SpectrumPlot />
    </section>
  )
}

const IDLE_SPECTRUM = 'rsat-idle-spectrum'      // this browser's choice, kept across visits

function storedFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

function storeFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private mode */ }
}

/** Between passes: the band's spectrum on request, when SatDump keeps the receiver on. */
function IdleReceiver({ stopsWhenIdle, frequency }: { stopsWhenIdle: boolean; frequency?: number }) {
  const t = useT()
  const [on, setOn] = useState(() => storedFlag(IDLE_SPECTRUM))
  function toggle() {
    storeFlag(IDLE_SPECTRUM, !on)
    setOn(!on)
  }
  return (
    <section>
      <h2>{t('live.idleTitle')}</h2>
      {stopsWhenIdle ? (
        <p className="hint">{t('live.idleOff')} <Link to="/settings">{t('live.idleSettings')}</Link></p>
      ) : (
        <>
          <p className="hint">{t('live.idleHint')}</p>
          <div className="row">
            <button onClick={toggle}>{on ? t('live.idleHide') : t('live.idleShow')}</button>
            {frequency ? <span className="hint">{t('live.tuned', { f: (frequency / 1e6).toFixed(3) })}</span> : null}
          </div>
          {on && <SpectrumPlot />}
        </>
      )}
    </section>
  )
}
