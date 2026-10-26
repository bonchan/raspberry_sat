import { useCallback, useEffect, useState } from 'react'
import { api, type Receiver, type ReceiverLink } from '../api'
import { ago, longDate } from '../format'
import { useT } from '../i18n'

/** Admins: the receivers (Pis) that may upload, each with its own token, and the stations (places) each has
    sent passes from. */
export default function Receivers() {
  const t = useT()
  const [receivers, setReceivers] = useState<Receiver[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [link, setLink] = useState<ReceiverLink | null>(null)
  const [name, setName] = useState('')

  const load = useCallback(() => api.receivers().then(setReceivers, e => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key)
    setError('')
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
      load()
    }
  }

  const add = () => act('add', async () => {
    setLink(await api.addReceiver(name.trim()))
    setName('')
  })

  const rename = (r: Receiver) => {
    const next = prompt(t('receivers.renamePrompt', { name: r.name }), r.name)?.trim()
    if (!next || next === r.name) return
    act(r.id, async () => { await api.renameReceiver(r.id, next) })
  }

  const newToken = (r: Receiver) => {
    if (!confirm(t('receivers.confirmToken', { name: r.name }))) return
    act(r.id, async () => setLink(await api.newToken(r.id)))
  }

  const revoke = (r: Receiver) => {
    if (!confirm(t('receivers.confirmRevoke', { name: r.name }))) return
    act(r.id, async () => { await api.revokeReceiver(r.id) })
  }

  const remove = (r: Receiver) => {
    if (!confirm(t('receivers.confirmDelete', { name: r.name, n: r.passes }))) return
    act(r.id, async () => {
      while (!(await api.deleteReceiver(r.id)).done) { /* a big receiver goes a batch of files at a time */ }
    })
  }

  return (
    <>
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      <section>
        <h2>{t('receivers.title')}</h2>
        <p className="hint">{t('receivers.hint')}</p>
        {error && <p className="error">{error}</p>}
        {receivers === null && !error && <p className="hint">{t('common.loading')}</p>}
        {receivers?.length === 0 && <p className="hint">{t('receivers.none')}</p>}
        {receivers && receivers.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>{t('receivers.receiver')}</th><th>{t('receivers.stations')}</th><th>{t('receivers.passes')}</th>
                  <th>{t('receivers.lastPass')}</th><th>{t('receivers.lastSeen')}</th><th>{t('receivers.added')}</th><th />
                </tr>
              </thead>
              <tbody>
                {receivers.map(r => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      {r.revoked_at && <> <span className="error">{t('receivers.revoked')}</span></>}
                    </td>
                    <td>
                      {r.stations.length
                        ? r.stations.map(s => s.name).join(', ')
                        : <span className="hint">{t('receivers.noStations')}</span>}
                    </td>
                    <td>{r.passes}</td>
                    <td>{r.last_pass ? longDate(r.last_pass) : '—'}</td>
                    <td>{ago(r.last_seen)}</td>
                    <td>{longDate(r.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button disabled={busy !== ''} onClick={() => rename(r)}>{t('receivers.rename')}</button>
                        <button disabled={busy !== ''} onClick={() => newToken(r)}>{t('receivers.newToken')}</button>
                        {!r.revoked_at && <button disabled={busy !== ''} onClick={() => revoke(r)}>{t('receivers.revoke')}</button>}
                        <button className="danger" disabled={busy !== ''} onClick={() => remove(r)}>
                          {busy === r.id ? t('receivers.working') : t('receivers.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>{t('receivers.add')}</h2>
        <div className="add-receiver">
          <label className="field">
            <span>{t('receivers.name')}</span>
            <input type="text" value={name} placeholder={t('receivers.namePlaceholder')} maxLength={60}
              onChange={e => setName(e.target.value)} />
          </label>
          <button className="primary" disabled={!name.trim() || busy !== ''} onClick={add}>{t('receivers.addButton')}</button>
        </div>
        <p className="hint">{t('receivers.addHint')}</p>
      </section>
    </>
  )
}

/** The URL and token for a Pi's settings, right after adding a receiver or making a new token. */
function LinkBox({ link, onDone }: { link: ReceiverLink; onDone: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => setCopied(what), () => setCopied(''))
  return (
    <section className="link-box">
      <h2>{t('link.title', { name: link.name })}</h2>
      <p>{t('link.where')}</p>
      <dl className="facts">
        <dt>URL</dt><dd><code>{link.url}</code></dd>
        <dd><button onClick={() => copy('url', link.url)}>{copied === 'url' ? t('link.copied') : t('link.copy')}</button></dd>
        <dt>Token</dt><dd><code>{link.token}</code></dd>
        <dd><button onClick={() => copy('token', link.token)}>{copied === 'token' ? t('link.copied') : t('link.copy')}</button></dd>
      </dl>
      <p className="caution">{t('link.once')}</p>
      <button onClick={onDone}>{t('link.done')}</button>
    </section>
  )
}
