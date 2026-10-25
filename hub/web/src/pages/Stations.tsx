import { useCallback, useEffect, useState } from 'react'
import { api, type Station, type StationLink } from '../api'
import { ago, longDate } from '../format'

/** "Casa de Juan" -> "casa-de-juan" */
const slug = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

/** Admins: the stations that may upload, each with its own token. */
export default function Stations() {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [link, setLink] = useState<StationLink | null>(null)
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idEdited, setIdEdited] = useState(false)

  const load = useCallback(() => api.stations().then(setStations, e => setError(e.message)), [])
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
    setLink(await api.addStation(id.trim(), name.trim()))
    setName('')
    setId('')
    setIdEdited(false)
  })

  const newToken = (s: Station) => {
    if (!confirm(`New token for ${s.name}? Its current token stops working at once; paste the new one into the station.`)) return
    act(s.id, async () => setLink(await api.newToken(s.id)))
  }

  const revoke = (s: Station) => {
    if (!confirm(`Revoke ${s.name}? It can no longer upload; its passes stay. "New token" lets it in again.`)) return
    act(s.id, async () => { await api.revokeStation(s.id) })
  }

  const remove = (s: Station) => {
    if (!confirm(`Delete ${s.name} and its ${s.passes} passes from the hub? This cannot be undone. The station keeps its own copies.`)) return
    act(s.id, async () => {
      while (!(await api.deleteStation(s.id)).done) { /* a big station goes a batch of files at a time */ }
    })
  }

  return (
    <>
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      <section>
        <h2>Stations</h2>
        {error && <p className="error">{error}</p>}
        {stations === null && !error && <p className="hint">Loading…</p>}
        {stations?.length === 0 && <p className="hint">No stations yet: add one below.</p>}
        {stations && stations.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr><th>Station</th><th>Passes</th><th>Last pass</th><th>Last heard from</th><th>Added</th><th /></tr>
              </thead>
              <tbody>
                {stations.map(s => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b> <span className="hint">{s.id}</span>
                      {s.revoked_at && <> <span className="error">revoked</span></>}
                    </td>
                    <td>{s.passes}</td>
                    <td>{s.last_pass ? longDate(s.last_pass) : '—'}</td>
                    <td>{ago(s.last_seen)}</td>
                    <td>{longDate(s.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button disabled={busy !== ''} onClick={() => newToken(s)}>New token</button>
                        {!s.revoked_at && <button disabled={busy !== ''} onClick={() => revoke(s)}>Revoke</button>}
                        <button className="danger" disabled={busy !== ''} onClick={() => remove(s)}>
                          {busy === s.id ? 'Working…' : 'Delete'}
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
        <h2>Add a station</h2>
        <div className="add-station">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} placeholder="Roof" maxLength={60}
              onChange={e => { setName(e.target.value); if (!idEdited) setId(slug(e.target.value)) }} />
          </label>
          <label className="field">
            <span>Id</span>
            <input type="text" value={id} placeholder="roof" maxLength={32}
              onChange={e => { setId(e.target.value); setIdEdited(true) }} />
          </label>
          <button className="primary" disabled={!name.trim() || !id.trim() || busy !== ''} onClick={add}>Add</button>
        </div>
        <p className="hint">
          The id is part of each pass's address on the hub and can't be changed later: lowercase letters, digits
          and dashes. The station gets a URL and a token to paste into its settings.
        </p>
      </section>
    </>
  )
}

/** The URL and token for a station's settings, right after adding it or making a new token. */
function LinkBox({ link, onDone }: { link: StationLink; onDone: () => void }) {
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => setCopied(what), () => setCopied(''))
  return (
    <section className="link-box">
      <h2>{link.name}: for the station's settings</h2>
      <p>On the station: <b>Settings → Destinations</b>, add one and paste these two.</p>
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
