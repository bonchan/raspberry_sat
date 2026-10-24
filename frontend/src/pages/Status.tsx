import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, type SatdumpProcess, type Status as StatusData, type SystemInfo, type ThrottleFlag } from '../api'
import { useConfirm } from '../Dialog'
import { useNow } from '../hooks'
import { duration, gb, longDate, percent } from '../format'
import { useT, type Key } from '../i18n'
import Fact from '../Fact'
import { useConnection, useTopic } from '../stream'
import Statistics from '../Statistics'
import Updates from '../Updates'

const STATE_CLASS: Record<SatdumpProcess['state'], string> = {
  running: 'ok', stopping: 'hint', stopped: 'hint', waiting: 'error', not_installed: 'error',
}

/** SatDump, then the system it runs on and its updates. */
export default function Status() {
  const t = useT()
  const status = useTopic('status') ?? null
  const connection = useConnection()
  const system = useTopic('system') ?? null
  const { hash, key } = useLocation()
  const loaded = !!status && !!system

  // /status#updates (the header badge, the danger zone): scroll once the sections above have their height
  useEffect(() => {
    if (hash === '#updates' && loaded) document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, key, loaded])

  return (
    <>
      {connection === 'down' && <p className="error">{t('status.backendDown')}</p>}
      <Receiver status={status} />
      <SystemFacts system={system} />
      <Statistics />
      <Updates />
    </>
  )
}

/** The Pi itself. Every row shows "…" until the first answer; rows the backend could not read (off the Pi)
    are left out after it. */
function SystemFacts({ system }: { system: SystemInfo | null }) {
  const t = useT()
  const loading = system === null
  const temp = system?.temperature ?? null, mem = system?.memory ?? null, cpu = system?.cpu ?? null
  const uptime = system?.uptime ?? null, power = system?.throttling ?? null
  const synced = system?.clock_synced ?? null, net = system?.network ?? null
  const flags = (list: ThrottleFlag[]) => list.map(f => t(`power.${f}` as Key)).join(', ')
  // since boot always repeats what is happening now; only show what is not
  const earlier = power ? power.since_boot.filter(f => !power.now.includes(f)) : []

  return (
    <section>
      <h2>{t('status.system')}</h2>
      <dl className="facts">
        <Fact label={t('status.host')} loading={loading} value={system?.hostname} />
        <Fact label={t('status.code')} loading={loading} value={system?.version} />
        <Fact label={t('status.uptime')} loading={loading} value={uptime !== null && <>
          {duration(uptime)} <span className="hint">· {t('status.since', { time: longDate(Date.now() / 1000 - uptime) })}</span>
        </>} />
        <Fact label={t('status.clock')} loading={loading} value={synced !== null && (
          <span className={synced ? 'ok' : 'error'}>{t(synced ? 'status.clockSynced' : 'status.clockNotSynced')}</span>
        )} />
        <Fact label={t('status.power')} loading={loading} value={power && <>
          {power.now.length === 0 && earlier.length === 0 && <span className="ok">{t('status.powerOk')}</span>}
          {power.now.length > 0 && <span className="error">{t('status.powerNow', { flags: flags(power.now) })}</span>}
          {power.now.length > 0 && earlier.length > 0 && ' · '}
          {earlier.length > 0 && <span className="caution">{t('status.powerSinceBoot', { flags: flags(earlier) })}</span>}
          {power.since_boot.includes('under_voltage') && <div className="hint">{t('status.underVoltageHint')}</div>}
        </>} />
        <Fact label={t('status.temperature')} loading={loading} value={temp !== null && <>
          <span className={temp >= 80 ? 'error' : temp >= 70 ? 'caution' : ''}>{temp.toFixed(1)} °C</span>
          {temp >= 70 && <span className="hint"> · {t('status.hot')}</span>}
        </>} />
        <Fact label={t('status.cpu')} loading={loading} value={cpu && <>
          <span className={cpu.usage >= 0.9 ? 'caution' : ''}>{percent(cpu.usage)}</span>
          {cpu.cores && <span className="hint"> · {t('status.cpuCores', { n: cpu.cores })}</span>}
        </>} />
        <Fact label={t('status.memory')} loading={loading} value={mem &&
          t('status.memoryUsage', { used: gb(mem.used), total: gb(mem.total), share: percent(mem.used / mem.total) })} />
        <Fact label={t('status.disk')} loading={loading} value={system &&
          t('status.diskUsage', { used: gb(system.disk.used), free: gb(system.disk.free), total: gb(system.disk.total) })} />
        <Fact label={t('status.network')} loading={loading} value={net && <>
          {net.ethernet && t('status.ethernet')}
          {net.ethernet && net.wifi && ' · '}
          {net.wifi && <>
            {t('status.wifi', { ssid: net.wifi.ssid })}{' '}
            <span className={net.wifi.signal < 30 ? 'error' : net.wifi.signal < 55 ? 'caution' : ''}>{net.wifi.signal}%</span>
          </>}
          {!net.ethernet && !net.wifi && <span className="error">{t('status.noNetwork')}</span>}
        </>} />
        <Fact label={t('status.data')} loading={loading} value={system?.data_dir} />
      </dl>
    </section>
  )
}

/** SatDump's process; until the first answer the rows show "…" and the buttons wait. */
function Receiver({ status }: { status: StatusData | null }) {
  const t = useT()
  const ask = useConfirm()
  const p = status?.satdump ?? null
  const loading = p === null
  const now = useNow()
  const [busy, setBusy] = useState(false)

  async function control(action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && status?.receiving) {
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
        <Fact label={t('status.state')} loading={loading} value={p && (
          <span className={STATE_CLASS[p.state]}>{t(`state.${p.state}` as Key)}</span>
        )} />
        {/* while loading, "running for" holds the place that "last exit" takes when SatDump is stopped */}
        <Fact label={t('status.runningFor')} loading={loading} value={p?.started_at && duration(now - p.started_at)} />
        {p && p.exit_code !== null && p.state !== 'running' && <><dt>{t('status.lastExit')}</dt><dd>{p.exit_code}</dd></>}
        {p?.restart_pending && <><dt>{t('status.pending')}</dt><dd>{t('status.pendingRestart', { reason: p.restart_reason })}</dd></>}
      </dl>
      <div className="row">
        <button disabled={!p || busy || (p.wanted && p.state !== 'stopped')} onClick={() => control('start')}>{t('status.start')}</button>
        <button disabled={!p || busy || !p.wanted} onClick={() => control('stop')}>{t('status.stop')}</button>
        <button disabled={!p || busy || p.state === 'not_installed'} onClick={() => control('restart')}>{t('status.restart')}</button>
      </div>
      <p className="hint">{t('status.stopHint')}</p>
    </section>
  )
}
