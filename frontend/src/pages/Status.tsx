import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, type SatdumpProcess, type Status as StatusData, type SystemInfo, type ThrottleFlag } from '../api'
import { useConfirm } from '../Dialog'
import { useNow, usePolling } from '../hooks'
import { duration, gb, longDate, percent } from '../format'
import { useT, type Key } from '../i18n'
import Updates from '../Updates'

const STATE_CLASS: Record<SatdumpProcess['state'], string> = {
  running: 'ok', stopping: 'hint', stopped: 'hint', waiting: 'error', not_installed: 'error',
}

/** SatDump, then the system it runs on and its updates. */
export default function Status() {
  const t = useT()
  const { data: status, error } = usePolling(api.getStatus, 2000)
  const { data: system } = usePolling(api.getSystem, 10000)
  const { hash, key } = useLocation()
  const loaded = !!status && !!system

  // /status#updates (the header badge, the danger zone): scroll once the sections above have their height
  useEffect(() => {
    if (hash === '#updates' && loaded) document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, key, loaded])

  return (
    <>
      {error && <p className="error">{t('status.backendDown', { error })}</p>}
      {status && <Receiver status={status} />}
      {system && <SystemFacts system={system} />}
      <Updates />
    </>
  )
}

/** The Pi itself. Rows the backend could not read (off the Pi) are left out. */
function SystemFacts({ system }: { system: SystemInfo }) {
  const t = useT()
  const { temperature: temp, memory: mem, uptime, throttling: power, clock_synced: synced, network: net } = system
  const flags = (list: ThrottleFlag[]) => list.map(f => t(`power.${f}` as Key)).join(', ')
  // since boot always repeats what is happening now; only show what is not
  const earlier = power ? power.since_boot.filter(f => !power.now.includes(f)) : []

  return (
    <section>
      <h2>{t('status.system')}</h2>
      <dl className="facts">
        <dt>{t('status.host')}</dt><dd>{system.hostname}</dd>
        <dt>{t('status.code')}</dt><dd>{system.version}</dd>
        {uptime !== null && <>
          <dt>{t('status.uptime')}</dt>
          <dd>{duration(uptime)} <span className="hint">· {t('status.since', { time: longDate(Date.now() / 1000 - uptime) })}</span></dd>
        </>}
        {synced !== null && <>
          <dt>{t('status.clock')}</dt>
          <dd className={synced ? 'ok' : 'error'}>{t(synced ? 'status.clockSynced' : 'status.clockNotSynced')}</dd>
        </>}
        {power && <>
          <dt>{t('status.power')}</dt>
          <dd>
            {power.now.length === 0 && earlier.length === 0 && <span className="ok">{t('status.powerOk')}</span>}
            {power.now.length > 0 && <span className="error">{t('status.powerNow', { flags: flags(power.now) })}</span>}
            {power.now.length > 0 && earlier.length > 0 && ' · '}
            {earlier.length > 0 && <span className="caution">{t('status.powerSinceBoot', { flags: flags(earlier) })}</span>}
            {power.since_boot.includes('under_voltage') && <div className="hint">{t('status.underVoltageHint')}</div>}
          </dd>
        </>}
        {temp !== null && <>
          <dt>{t('status.temperature')}</dt>
          <dd>
            <span className={temp >= 80 ? 'error' : temp >= 70 ? 'caution' : ''}>{temp.toFixed(1)} °C</span>
            {temp >= 70 && <span className="hint"> · {t('status.hot')}</span>}
          </dd>
        </>}
        {mem && <>
          <dt>{t('status.memory')}</dt>
          <dd>{t('status.memoryUsage', { used: gb(mem.used), total: gb(mem.total), share: percent(mem.used / mem.total) })}</dd>
        </>}
        <dt>{t('status.disk')}</dt>
        <dd>{t('status.diskUsage', { used: gb(system.disk.used), free: gb(system.disk.free), total: gb(system.disk.total) })}</dd>
        {net && <>
          <dt>{t('status.network')}</dt>
          <dd>
            {net.ethernet && t('status.ethernet')}
            {net.ethernet && net.wifi && ' · '}
            {net.wifi && <>
              {t('status.wifi', { ssid: net.wifi.ssid })}{' '}
              <span className={net.wifi.signal < 30 ? 'error' : net.wifi.signal < 55 ? 'caution' : ''}>{net.wifi.signal}%</span>
            </>}
            {!net.ethernet && !net.wifi && <span className="error">{t('status.noNetwork')}</span>}
          </dd>
        </>}
        <dt>{t('status.data')}</dt><dd>{system.data_dir}</dd>
      </dl>
    </section>
  )
}

function Receiver({ status }: { status: StatusData }) {
  const t = useT()
  const ask = useConfirm()
  const p = status.satdump
  const now = useNow()
  const [busy, setBusy] = useState(false)

  async function control(action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && status.receiving) {
      const label = t(action === 'stop' ? 'status.stop' : 'status.restart')
      if (!(await ask({ title: label, message: t('status.confirmInterrupt'), confirmLabel: label, danger: true }))) return
    }
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
