import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SatdumpProcess, type Status as StatusData } from '../api'
import { useNow, usePolling } from '../hooks'
import { clock, dateTime, duration, gb, utcClock } from '../format'
import UpcomingPasses from '../UpcomingPasses'

const STATE_LABEL: Record<SatdumpProcess['state'], [string, string]> = {
  running: ['running', 'ok'],
  stopping: ['stopping (finishing the last pass)', 'hint'],
  stopped: ['stopped', 'hint'],
  waiting: ['crashed, starting again shortly', 'error'],
  not_installed: ['SatDump is not installed', 'error'],
}

export default function Status() {
  const { data: status, error } = usePolling(api.getStatus, 2000)
  const { data: system } = usePolling(api.getSystem, 30000)
  const { data: config } = usePolling(api.getConfig, 60000)
  const running = status?.satdump.state === 'running'

  return (
    <>
      {error && <p className="error">Backend not answering: {error}</p>}
      {status && <Receiver status={status} />}
      {status && running && <NextPass status={status} />}
      <UpcomingPasses minElevation={config?.tracking.min_elevation}
        station={config?.stations[config.active_station]?.name}
        showLow={config?.display.show_low_passes ?? true} />
      {system && (
        <section>
          <h2>System</h2>
          <dl className="facts">
            <dt>Host</dt><dd>{system.hostname}</dd>
            <dt>Code</dt><dd>{system.version}</dd>
            <dt>Data</dt><dd>{system.data_dir}</dd>
            <dt>Disk</dt>
            <dd>{gb(system.disk.used)} used, {gb(system.disk.free)} free of {gb(system.disk.total)}</dd>
          </dl>
        </section>
      )}
    </>
  )
}

function Receiver({ status }: { status: StatusData }) {
  const p = status.satdump
  const now = useNow()
  const [busy, setBusy] = useState(false)
  const [label, cls] = STATE_LABEL[p.state]

  async function control(action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && status.receiving &&
      !confirm('A pass is being received right now. Interrupt it?')) return
    setBusy(true)
    try { await api.satdump(action) } finally { setBusy(false) }
  }

  return (
    <section>
      <h2>SatDump</h2>
      <dl className="facts">
        <dt>State</dt><dd className={cls}>{label}</dd>
        {p.started_at && <><dt>Running for</dt><dd>{duration(now - p.started_at)}</dd></>}
        {p.exit_code !== null && p.state !== 'running' && <><dt>Last exit code</dt><dd>{p.exit_code}</dd></>}
        {p.restart_pending && <><dt>Pending</dt><dd>restart ({p.restart_reason}), once no pass is running</dd></>}
      </dl>
      <div className="row">
        <button disabled={busy || (p.wanted && p.state !== 'stopped')} onClick={() => control('start')}>Start</button>
        <button disabled={busy || !p.wanted} onClick={() => control('stop')}>Stop</button>
        <button disabled={busy || p.state === 'not_installed'} onClick={() => control('restart')}>Restart</button>
      </div>
      <p className="hint">Stop lasts until Start, or until the Pi or the app restarts.</p>
    </section>
  )
}

function NextPass({ status }: { status: StatusData }) {
  const now = useNow()
  const t = status.tracker?.object_tracker
  if (!t) return <section><h2>Pass</h2><p className="hint">Waiting for SatDump to answer…</p></section>

  const hasPass = t.next_los_time > 0
  const stale = status.tracker_age !== null && status.tracker_age > 10
  // SatDump's tracker follows every pass of the satellite; low ones are skipped, nothing is received
  const skipped = status.overhead && !status.receiving
  const title = status.receiving ? 'Receiving now' : skipped ? 'Overhead now, not recorded' : 'Next pass (SatDump)'
  return (
    <section>
      <h2>{title}</h2>
      {!hasPass && <p className="hint">No pass scheduled. Check the satellites and minimum elevation in Settings.</p>}
      {hasPass && (
        <dl className="facts">
          <dt>Satellite</dt><dd>{t.object_name}</dd>
          {status.overhead
            ? <><dt>Ends</dt><dd>{clock(t.next_los_time)} ({utcClock(t.next_los_time)} UTC), in {duration(t.next_los_time - now)}</dd></>
            : <><dt>Starts</dt><dd>{dateTime(t.next_aos_time)} ({utcClock(t.next_aos_time)} UTC), in {duration(t.next_aos_time - now)}</dd>
                <dt>Ends</dt><dd>{clock(t.next_los_time)} ({utcClock(t.next_los_time)} UTC)</dd></>}
          {t.sat_current_pos.el > 0 && <>
            <dt>Position</dt>
            <dd>az {t.sat_current_pos.az.toFixed(1)}°, el {t.sat_current_pos.el.toFixed(1)}°
              {t.sat_current_range !== undefined && `, ${Math.round(t.sat_current_range)} km`}</dd>
          </>}
          {status.receiving && status.tracker &&
            <><dt>Tuned to</dt><dd>{(status.tracker.frequency / 1e6).toFixed(3)} MHz</dd></>}
        </dl>
      )}
      {skipped && <p className="hint">This pass stays under the minimum elevation, so SatDump leaves the radio off.</p>}
      {stale && <p className="hint">Status is {Math.round(status.tracker_age!)} s old.</p>}
      {status.receiving && <p><Link to="/live">Watch it live →</Link></p>}
    </section>
  )
}
