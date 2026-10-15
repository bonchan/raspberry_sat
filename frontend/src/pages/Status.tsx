import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SatdumpProcess, type Status as StatusData, type UpcomingPass } from '../api'
import { useNow, usePolling } from '../hooks'
import { clock, duration, gb, sameDay, utcClock, weekdayShort } from '../format'
import { useT, type Key } from '../i18n'
import UpcomingPasses from '../UpcomingPasses'

const STATE_CLASS: Record<SatdumpProcess['state'], string> = {
  running: 'ok', stopping: 'hint', stopped: 'hint', waiting: 'error', not_installed: 'error',
}

export default function Status() {
  const t = useT()
  const { data: status, error } = usePolling(api.getStatus, 2000)
  const { data: system } = usePolling(api.getSystem, 30000)
  const { data: config } = usePolling(api.getConfig, 60000)
  const { data: update } = usePolling(api.getUpdate, 60000)
  const { data: schedule } = usePolling(api.getSchedule, 60000)
  const running = status?.satdump.state === 'running'
  const behind = update?.behind ?? 0

  return (
    <>
      {error && <p className="error">{t('status.backendDown', { error })}</p>}
      {status && <Receiver status={status} />}
      {status && running && <NextPass status={status} passes={schedule?.passes ?? []} />}
      <UpcomingPasses minElevation={config?.tracking.min_elevation}
        station={config?.stations[config.active_station]?.name}
        showLow={config?.display.show_low_passes ?? true} />
      {system && (
        <section>
          <h2>{t('status.system')}</h2>
          <dl className="facts">
            <dt>{t('status.host')}</dt><dd>{system.hostname}</dd>
            <dt>{t('status.code')}</dt><dd>{system.version}</dd>
            <dt>{t('status.data')}</dt><dd>{system.data_dir}</dd>
            <dt>{t('status.disk')}</dt>
            <dd>{t('status.diskUsage', { used: gb(system.disk.used), free: gb(system.disk.free), total: gb(system.disk.total) })}</dd>
            <dt>{t('status.updates')}</dt>
            <dd>
              {behind === 0 ? t('status.upToDate')
                : behind === 1 ? t('status.updatesOne') : t('status.updatesMany', { n: behind })}{' '}
              <Link to="/update">{t('status.review')}</Link>
            </dd>
          </dl>
        </section>
      )}
    </>
  )
}

function Receiver({ status }: { status: StatusData }) {
  const t = useT()
  const p = status.satdump
  const now = useNow()
  const [busy, setBusy] = useState(false)

  async function control(action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && status.receiving && !confirm(t('status.confirmInterrupt'))) return
    setBusy(true)
    try { await api.satdump(action) } finally { setBusy(false) }
  }

  return (
    <section>
      <h2>SatDump</h2>
      <dl className="facts">
        <dt>{t('status.state')}</dt><dd className={STATE_CLASS[p.state]}>{t(`state.${p.state}` as Key)}</dd>
        {p.started_at && <><dt>{t('status.runningFor')}</dt><dd>{duration(now - p.started_at)}</dd></>}
        {p.exit_code !== null && p.state !== 'running' && <><dt>{t('status.lastExit')}</dt><dd>{p.exit_code}</dd></>}
        {p.restart_pending && <><dt>{t('status.pending')}</dt><dd>{t('status.pendingRestart', { reason: p.restart_reason })}</dd></>}
      </dl>
      <div className="row">
        <button disabled={busy || (p.wanted && p.state !== 'stopped')} onClick={() => control('start')}>{t('status.start')}</button>
        <button disabled={busy || !p.wanted} onClick={() => control('stop')}>{t('status.stop')}</button>
        <button disabled={busy || p.state === 'not_installed'} onClick={() => control('restart')}>{t('status.restart')}</button>
      </div>
      <p className="hint">{t('status.stopHint')}</p>
    </section>
  )
}

function NextPass({ status, passes }: { status: StatusData; passes: UpcomingPass[] }) {
  const t = useT()
  const now = useNow()
  const tr = status.tracker?.object_tracker
  if (!tr) return <section><h2>{t('status.pass')}</h2><p className="hint">{t('status.waitingSatdump')}</p></section>

  const stale = status.tracker_age !== null && status.tracker_age > 10
  // SatDump's tracker follows every pass of the satellite; low ones are skipped, nothing is received
  const skipped = status.overhead && !status.receiving
  const title = status.receiving ? t('status.receivingNow')
    : skipped ? t('status.overheadNotRecorded') : t('status.nextPass')
  // During a pass: the one going on, from SatDump's tracker. Otherwise: the next pass SatDump will record,
  // from the schedule. The tracker's own "next pass" may be one too low to record.
  const next = passes.find(p => p.scheduled && p.aos > now)
  const pass = status.overhead
    ? { name: tr.object_name, aos: tr.next_aos_time, los: tr.next_los_time }
    : next && { name: next.name, aos: next.aos, los: next.los }
  // "Today", or the weekday, next to a time
  const day = (unix: number) => sameDay(unix, now) ? t('up.today') : weekdayShort(unix)
  const showPosition = status.overhead && tr.sat_current_pos.el > 0
  return (
    <section>
      <h2>{title}{pass && ` · ${pass.name}`}</h2>
      {!pass && <p className="hint">{t('status.noPass')}</p>}
      {pass && (
        <div className="pass-cards">
          <div className="tile">
            <small>{t('status.starts')}</small>
            <b>{clock(pass.aos)}</b>
            <small>{day(pass.aos)} · {utcClock(pass.aos)} UTC</small>
          </div>
          <div className="tile">
            <small>{t('status.ends')}</small>
            <b>{clock(pass.los)}</b>
            <small>{day(pass.los)} · {utcClock(pass.los)} UTC</small>
          </div>
          <div className={status.overhead ? 'tile countdown now' : 'tile countdown'}>
            <small>{status.overhead ? t('status.endsIn') : t('status.startsIn')}</small>
            <b>{duration((status.overhead ? pass.los : pass.aos) - now)}</b>
          </div>
        </div>
      )}
      {(showPosition || status.receiving) && (
        <dl className="facts">
          {showPosition && <>
            <dt>{t('status.position')}</dt>
            <dd>az {tr.sat_current_pos.az.toFixed(1)}°, el {tr.sat_current_pos.el.toFixed(1)}°
              {tr.sat_current_range !== undefined && `, ${Math.round(tr.sat_current_range)} km`}</dd>
          </>}
          {status.receiving && status.tracker &&
            <><dt>{t('status.tunedTo')}</dt><dd>{(status.tracker.frequency / 1e6).toFixed(3)} MHz</dd></>}
        </dl>
      )}
      {skipped && <p className="hint">{t('status.skippedHint')}</p>}
      {stale && <p className="hint">{t('status.stale', { s: Math.round(status.tracker_age!) })}</p>}
      {status.receiving && <p><Link to="/live">{t('status.watchLive')}</Link></p>}
    </section>
  )
}
