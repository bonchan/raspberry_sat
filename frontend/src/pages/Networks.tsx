import { useEffect, useState } from 'react'
import { api, ApiError, type NearbyNetwork, type NetworksState, type NewNetwork, type SavedNetwork } from '../api'
import { CheckField, NumberField, TextField } from '../fields'
import { useT } from '../i18n'

const emptyForm = (): NewNetwork => ({ ssid: '', password: '', priority: 0, hidden: false, security: '' })

const message = (e: unknown) => e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e)

export default function Networks() {
  const t = useT()
  const [state, setState] = useState<NetworksState | null>(null)
  const [nearby, setNearby] = useState<NearbyNetwork[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [form, setForm] = useState<NewNetwork>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = () => api.getNetworks().then(setState, e => setError(message(e)))
  useEffect(() => { load() }, [])

  async function scan() {
    setScanning(true); setError('')
    try { setNearby((await api.scanNetworks()).networks) } catch (e) { setError(message(e)) } finally { setScanning(false) }
  }

  /** Run a change, show what `fn` returns as the notice, reload the list. */
  async function act(fn: () => Promise<string | void>) {
    setBusy(true); setError(''); setNotice('')
    try {
      setNotice((await fn()) || '')
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const save = () => act(async () => {
    const r = await api.saveNetwork(form)
    setForm(emptyForm())
    return t(r.result === 'added' ? 'net.added' : 'net.updated', { ssid: form.ssid })
  })

  function pick(n: NearbyNetwork) {
    const security = n.security === '' ? '' : /WPA3/.test(n.security) && !/WPA2/.test(n.security) ? 'sae' : 'wpa-psk'
    const known = state?.saved.find(s => s.ssid === n.ssid)
    setForm({ ...emptyForm(), ssid: n.ssid, security, priority: known?.priority ?? 0 })
  }

  if (!state) return <section>{error ? <p className="error">{error}</p> : <p className="hint">{t('common.loading')}</p>}</section>
  if (state.error) return <section><h2>{t('net.title')}</h2><p className="error">{t('net.unavailable', { error: state.error })}</p></section>

  const savedNames = new Set(state.saved.map(s => s.ssid))

  return (
    <>
      <section>
        <h2>{t('net.connection')}</h2>
        <dl className="facts">
          {state.devices.map(d => (
            <div key={d.device} className="contents">
              <dt>{t(d.type === 'wifi' ? 'net.wifi' : 'net.ethernet')} ({d.device})</dt>
              <dd className={d.connected ? 'ok' : 'hint'}>{d.connected ? d.connection : t('net.notConnected')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>{t('net.saved')}</h2>
        {state.saved.length === 0 && <p className="hint">{t('net.noneSaved')}</p>}
        {state.saved.length > 0 && (
          <table className="sats">
            <thead><tr><th>{t('net.network')}</th><th>{t('net.priority')}</th><th></th></tr></thead>
            <tbody>
              {state.saved.map(n => (
                <SavedRow key={n.uuid} network={n} busy={busy}
                  onPriority={p => act(async () => { await api.setNetworkPriority(n.uuid, p) })}
                  onForget={() => confirm(t('net.confirmForget', { ssid: n.ssid }))
                    && act(async () => { await api.forgetNetwork(n.uuid) })} />
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">{t('net.savedHint')}</p>
      </section>

      <section>
        <h2>{t('net.add')}</h2>
        <div className="grid">
          <TextField label={t('net.ssid')} value={form.ssid} onChange={ssid => setForm({ ...form, ssid })} />
          <label className="field">
            <span>{t('net.password')}</span>
            <input type="password" autoComplete="new-password" value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} />
            <small>{t('net.passwordHint')}</small>
          </label>
          <NumberField label={t('net.priority')} step="1" value={form.priority} onChange={priority => setForm({ ...form, priority })} />
          <CheckField label={t('net.hidden')} value={form.hidden} onChange={hidden => setForm({ ...form, hidden })} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || !form.ssid} onClick={save}>{t('net.saveButton')}</button>
        </div>
        <p className="hint">{t('net.phoneTip')}</p>
      </section>

      {(notice || error) && <section>{notice && <p className="ok">{notice}</p>}{error && <p className="error">{error}</p>}</section>}

      <section>
        <h2>{t('net.nearby')}</h2>
        <div className="row">
          <button disabled={scanning} onClick={scan}>{scanning ? t('net.scanning') : t('net.scan')}</button>
          {nearby && nearby.length > 0 && <span className="hint">{t('net.pick')}</span>}
        </div>
        {nearby && nearby.length === 0 && <p className="hint">{t('net.noneFound')}</p>}
        {nearby && nearby.length > 0 && (
          <table className="passes nearby">
            <tbody>
              {nearby.map(n => (
                <tr key={n.ssid} onClick={() => pick(n)} className={form.ssid === n.ssid ? 'on' : undefined}>
                  <td>{n.ssid}{n.in_use && <span className="ok"> · {t('net.inUse')}</span>}
                    {!n.in_use && savedNames.has(n.ssid) && <span className="hint"> · {t('net.savedMark')}</span>}</td>
                  <td className="signal"><span className="bar"><span style={{ width: `${n.signal}%` }} /></span> {n.signal}%</td>
                  <td className="hint">{n.security || t('net.open')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function SavedRow({ network, busy, onPriority, onForget }: {
  network: SavedNetwork; busy: boolean; onPriority: (p: number) => void; onForget: () => void
}) {
  const t = useT()
  const [priority, setPriority] = useState(network.priority)
  useEffect(() => setPriority(network.priority), [network.priority])
  return (
    <tr className={network.active ? 'selected' : undefined}>
      <td>
        {network.ssid}
        {network.active && <span className="ok"> · {t('net.inUse')}</span>}
        {network.name !== network.ssid && <span className="hint"> ({network.name})</span>}
      </td>
      <td>
        <div className="row inline">
          <input type="number" step="1" value={Number.isNaN(priority) ? '' : priority}
            onChange={e => setPriority(e.target.value === '' ? NaN : Number(e.target.value))} />
          {priority !== network.priority &&
            <button disabled={busy || Number.isNaN(priority)} onClick={() => onPriority(priority)}>{t('net.set')}</button>}
        </div>
      </td>
      <td><button className="danger" disabled={busy || network.active} onClick={onForget}>{t('net.forget')}</button></td>
    </tr>
  )
}
