import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SatdumpProcess, type Status as StatusData } from '../api'
import { useNow, usePolling } from '../hooks'
import { duration, gb } from '../format'
import { useT, type Key } from '../i18n'

const STATE_CLASS: Record<SatdumpProcess['state'], string> = {
  running: 'ok', stopping: 'hint', stopped: 'hint', waiting: 'error', not_installed: 'error',
}

/** SatDump, then the system it runs on. */
export default function Status() {
  const t = useT()
  const { data: status, error } = usePolling(api.getStatus, 2000)
  const { data: system } = usePolling(api.getSystem, 30000)
  const { data: update } = usePolling(api.getUpdate, 60000)
  const behind = update?.behind ?? 0

  return (
    <>
      {error && <p className="error">{t('status.backendDown', { error })}</p>}
      {status && <Receiver status={status} />}
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
