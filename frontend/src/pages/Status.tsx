import { useState } from 'react'
import { api, satdumpImage, type SatdumpProcess, type Status as StatusData } from '../api'
import { useNow, usePolling, useTick } from '../hooks'
import { clock, dateTime, duration, gb } from '../format'

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
  const running = status?.satdump.state === 'running'

  return (
    <>
      {error && <p className="error">Backend not answering: {error}</p>}
      {status && <Receiver status={status} />}
      {status && running && <NextPass status={status} />}
      {running && <Plots />}
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
    if (action !== 'start' && status.in_pass &&
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
  return (
    <section>
      <h2>{status.in_pass ? 'Receiving now' : 'Next pass'}</h2>
      {!hasPass && <p className="hint">No pass scheduled. Check the satellites and minimum elevation in Settings.</p>}
      {hasPass && (
        <dl className="facts">
          <dt>Satellite</dt><dd>{t.object_name}</dd>
          {status.in_pass
            ? <><dt>Ends</dt><dd>{clock(t.next_los_time)}, in {duration(t.next_los_time - now)}</dd></>
            : <><dt>Starts</dt><dd>{dateTime(t.next_aos_time)}, in {duration(t.next_aos_time - now)}</dd>
                <dt>Ends</dt><dd>{clock(t.next_los_time)}</dd></>}
          {t.sat_current_pos.el > 0 && <>
            <dt>Position</dt>
            <dd>az {t.sat_current_pos.az.toFixed(1)}°, el {t.sat_current_pos.el.toFixed(1)}°
              {t.sat_current_range !== undefined && `, ${Math.round(t.sat_current_range)} km`}</dd>
          </>}
          {status.tracker && <><dt>Tuned to</dt><dd>{(status.tracker.frequency / 1e6).toFixed(3)} MHz</dd></>}
        </dl>
      )}
      {stale && <p className="hint">Status is {Math.round(status.tracker_age!)} s old.</p>}
    </section>
  )
}

function Plots() {
  const tick = useTick(2000)
  const [showFft, setShowFft] = useState(false)
  const fftTick = useTick(1000, showFft)
  return (
    <section>
      <h2>Sky and schedule</h2>
      <div className="plots">
        <img className="polar" src={satdumpImage('polarplot', tick)} alt="Polar plot of the next pass" />
        <img className="schedule" src={satdumpImage('schedule', Math.floor(tick / 30000))} alt="Upcoming passes" />
      </div>
      <div className="row">
        <button onClick={() => setShowFft(s => !s)}>{showFft ? 'Hide spectrum' : 'Show spectrum'}</button>
        <span className="hint">The spectrum is only live while the receiver runs, during passes unless "stop SDR between passes" is off.</span>
      </div>
      {showFft && <img className="fft" src={satdumpImage('fft', fftTick)} alt="Live spectrum" />}
    </section>
  )
}
