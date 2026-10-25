import { useCallback, useEffect, useState } from 'react'
import { api, type Receiver, type ReceiverLink } from '../api'
import { ago, longDate } from '../format'

/** Admins: the receivers (Pis) that may upload, each with its own token, and the stations (places) each has
    sent passes from. */
export default function Receivers() {
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
    const next = prompt(`New name for ${r.name}:`, r.name)?.trim()
    if (!next || next === r.name) return
    act(r.id, async () => { await api.renameReceiver(r.id, next) })
  }

  const newToken = (r: Receiver) => {
    if (!confirm(`New token for ${r.name}? Its current token stops working at once; paste the new one into the Pi.`)) return
    act(r.id, async () => setLink(await api.newToken(r.id)))
  }

  const revoke = (r: Receiver) => {
    if (!confirm(`Revoke ${r.name}? It can no longer upload; its passes stay. "New token" lets it in again.`)) return
    act(r.id, async () => { await api.revokeReceiver(r.id) })
  }

  const remove = (r: Receiver) => {
    if (!confirm(`Delete ${r.name} and its ${r.passes} passes from the hub? This cannot be undone. The Pi keeps its own copies.`)) return
    act(r.id, async () => {
      while (!(await api.deleteReceiver(r.id)).done) { /* a big receiver goes a batch of files at a time */ }
    })
  }

  return (
    <>
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      <section>
        <h2>Receivers</h2>
        <p className="hint">One per Pi. Its stations are the places set in the Pi's Settings → Stations; each pass says which one received it.</p>
        {error && <p className="error">{error}</p>}
        {receivers === null && !error && <p className="hint">Loading…</p>}
        {receivers?.length === 0 && <p className="hint">No receivers yet: add one below.</p>}
        {receivers && receivers.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr><th>Receiver</th><th>Stations</th><th>Passes</th><th>Last pass</th><th>Last heard from</th><th>Added</th><th /></tr>
              </thead>
              <tbody>
                {receivers.map(r => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      {r.revoked_at && <> <span className="error">revoked</span></>}
                    </td>
                    <td>{r.stations.length ? r.stations.map(s => s.name).join(', ') : <span className="hint">none yet</span>}</td>
                    <td>{r.passes}</td>
                    <td>{r.last_pass ? longDate(r.last_pass) : '—'}</td>
                    <td>{ago(r.last_seen)}</td>
                    <td>{longDate(r.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button disabled={busy !== ''} onClick={() => rename(r)}>Rename</button>
                        <button disabled={busy !== ''} onClick={() => newToken(r)}>New token</button>
                        {!r.revoked_at && <button disabled={busy !== ''} onClick={() => revoke(r)}>Revoke</button>}
                        <button className="danger" disabled={busy !== ''} onClick={() => remove(r)}>
                          {busy === r.id ? 'Working…' : 'Delete'}
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
        <h2>Add a receiver</h2>
        <div className="add-receiver">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} placeholder="Roof Pi" maxLength={60} onChange={e => setName(e.target.value)} />
          </label>
          <button className="primary" disabled={!name.trim() || busy !== ''} onClick={add}>Add</button>
        </div>
        <p className="hint">The hub gives it an id of its own and a URL and token to paste into the Pi's settings. The name can be changed later.</p>
      </section>
    </>
  )
}

/** The URL and token for a Pi's settings, right after adding a receiver or making a new token. */
function LinkBox({ link, onDone }: { link: ReceiverLink; onDone: () => void }) {
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => setCopied(what), () => setCopied(''))
  return (
    <section className="link-box">
      <h2>{link.name}: for the Pi's settings</h2>
      <p>On the Pi: <b>Settings → Destinations</b>, add one (or open the existing one) and paste these two.</p>
      <dl className="facts">
        <dt>URL</dt><dd><code>{link.url}</code></dd>
        <dd><button onClick={() => copy('url', link.url)}>{copied === 'url' ? 'Copied' : 'Copy'}</button></dd>
        <dt>Token</dt><dd><code>{link.token}</code></dd>
        <dd><button onClick={() => copy('token', link.token)}>{copied === 'token' ? 'Copied' : 'Copy'}</button></dd>
      </dl>
      <p className="caution">The token is shown only now. Lost it? "New token" makes another (the old one stops working).</p>
      <button onClick={onDone}>Done</button>
    </section>
  )
}
