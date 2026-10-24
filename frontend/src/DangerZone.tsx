import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from './api'
import { useConfirm } from './Dialog'
import { useT, type Key } from './i18n'
import { useTopic } from './stream'

type Action = 'restart-app' | 'reboot' | 'poweroff'

const ACTIONS: { action: Action; title: Key; hint: Key; button: Key; confirm: Key; done: Key }[] = [
  { action: 'restart-app', title: 'danger.restartApp', hint: 'danger.restartAppHint', button: 'danger.restartAppButton',
    confirm: 'danger.confirmRestartApp', done: 'danger.restartingApp' },
  { action: 'reboot', title: 'danger.reboot', hint: 'danger.rebootHint', button: 'danger.rebootButton',
    confirm: 'danger.confirmReboot', done: 'danger.rebooting' },
  { action: 'poweroff', title: 'danger.poweroff', hint: 'danger.poweroffHint', button: 'danger.poweroffButton',
    confirm: 'danger.confirmPoweroff', done: 'danger.poweringOff' },
]

/** Bottom of Settings: update, restart the app, reboot or shut down the Pi. */
export default function DangerZone() {
  const t = useT()
  const ask = useConfirm()
  const update = useTopic('update')
  const status = useTopic('status')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  const behind = update?.behind ?? 0

  async function run(a: (typeof ACTIONS)[number]) {
    const warning = status?.receiving ? t('danger.passWarning') + '\n\n' : ''
    if (!(await ask({ title: t(a.title), message: warning + t(a.confirm), confirmLabel: t(a.button), danger: true }))) return
    setBusy(true); setError(''); setDone('')
    try {
      await api.power(a.action)
      setDone(t(a.done))
    } catch (e) {
      setError(e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="danger-zone">
      <h2>{t('danger.title')}</h2>
      <div className="danger-row">
        <div>
          <b>{t('danger.update')}</b>
          <p className="hint">
            {behind === 0 ? t('status.upToDate') : behind === 1 ? t('status.updatesOne') : t('status.updatesMany', { n: behind })}
          </p>
        </div>
        <Link className="button danger" to="/status#updates">{t('danger.updateButton')}</Link>
      </div>
      <div className="danger-row">
        <div>
          <b>{t('danger.networks')}</b>
          <p className="hint">{t('danger.networksHint')}</p>
        </div>
        <Link className="button danger" to="/networks">{t('danger.networksButton')}</Link>
      </div>
      {ACTIONS.map(a => (
        <div key={a.action} className="danger-row">
          <div>
            <b>{t(a.title)}</b>
            <p className="hint">{t(a.hint)}</p>
          </div>
          <button className="danger" disabled={busy || done !== ''} onClick={() => run(a)}>{t(a.button)}</button>
        </div>
      ))}
      {done && <p className="ok">{done}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
