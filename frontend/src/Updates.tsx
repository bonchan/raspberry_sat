import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type PendingCommit, type UpdateState } from './api'
import { useConfirm } from './Dialog'
import { usePolling } from './hooks'
import { longDate } from './format'
import { useT } from './i18n'

/** The Updates section of the Status tab: what is new upstream, Update now, and the last update's log. */
export default function Updates() {
  const t = useT()
  const ask = useConfirm()
  // every few seconds, to follow an update while it runs; checking upstream is a separate button
  const { data: polled, error } = usePolling(api.getUpdate, 3000)
  const [fresh, setFresh] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [actionError, setActionError] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const firstSeen = useRef<string | null>(null)      // the version this page was loaded with

  // a check's answer until the next poll catches up with it (polls carry the live running state and log)
  const data = fresh && (!polled || (fresh.checked_at ?? 0) > (polled.checked_at ?? 0)) ? fresh : polled
  if (data?.current && firstSeen.current === null) firstSeen.current = data.current.hash

  // the log opens by itself while an update runs; otherwise it stays folded until clicked
  useEffect(() => { if (data?.running) setLogOpen(true) }, [data?.running])

  async function run(action: 'check' | 'apply') {
    setBusy(action); setActionError('')
    if (action === 'apply') setLogOpen(true)
    try {
      setFresh(action === 'check' ? await api.checkUpdate() : await api.applyUpdate())
    } catch (e) {
      setActionError(e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return (
      <section id="updates">
        <h2>{t('status.updates')}</h2>
        {error ? <p className="error">{error}</p> : <p className="hint">{t('common.loading')}</p>}
      </section>
    )
  }

  const behind = data.behind ?? 0
  const commits = data.commits ?? []
  const dirty = data.dirty ?? []
  const updated = data.current && firstSeen.current && data.current.hash !== firstSeen.current
  const blocked = data.running || dirty.length > 0 || (data.ahead ?? 0) > 0 || behind === 0

  return (
    <section id="updates">
      <h2>{t('status.updates')}</h2>
      {data.error && <p className="error">{data.error}</p>}
      {updated && (
        <p className="ok">
          {t('update.reload', { short: data.current!.short })}{' '}
          <button className="primary" onClick={() => window.location.reload()}>{t('update.reloadButton')}</button>
        </p>
      )}
      <dl className="facts">
        {data.current && <>
          <dt>{t('update.current')}</dt>
          <dd><code>{data.current.short}</code> {data.current.subject} <span className="hint">{longDate(data.current.time)}</span></dd>
        </>}
        {data.branch && <>
          <dt>{t('update.branch')}</dt><dd>{data.branch}{data.upstream && ` ← ${data.upstream}`}</dd>
        </>}
        <dt>{t('update.checked')}</dt><dd>{data.checked_at ? longDate(data.checked_at) : t('update.never')}</dd>
      </dl>
      <div className="row">
        <button disabled={busy !== null} onClick={() => run('check')}>
          {busy === 'check' ? t('update.checking') : t('update.check')}
        </button>
      </div>

      {!data.upstream && !data.error && <p className="hint">{t('update.noUpstream')}</p>}
      {data.upstream && behind === 0 && <p>{t('update.upToDate')}</p>}
      {behind > 0 && (
        <>
          <h3 className="subhead">{behind === 1 ? t('update.behindOne', { upstream: data.upstream! })
            : t('update.behindMany', { n: behind, upstream: data.upstream! })}</h3>
          {data.diffstat && <p className="hint">{data.diffstat}</p>}
          <ul className="commits">
            {commits.map(c => <Commit key={c.hash} commit={c} />)}
          </ul>
        </>
      )}
      {dirty.length > 0 && (
        <div className="warning">
          <p>{t('update.dirty')}</p>
          <ul className="files">{dirty.map(f => <li key={f}><code>{f}</code></li>)}</ul>
        </div>
      )}
      {(data.ahead ?? 0) > 0 && <p className="warning">{t('update.ahead', { n: data.ahead! })}</p>}
      {behind > 0 && (
        <>
          <p className="hint">{t('update.explain')}</p>
          <button className="primary" disabled={blocked || busy !== null}
            onClick={async () => {
              if (await ask({ title: t('update.title'), message: t('update.confirm', { short: commits[0]?.short ?? '' }),
                              confirmLabel: t('update.button') })) run('apply')
            }}>
            {t('update.button')}
          </button>
        </>
      )}
      {actionError && <p className="error">{actionError}</p>}

      {(data.running || data.last_run) && (
        <details className="update-details" open={logOpen}
          onToggle={e => setLogOpen(e.currentTarget.open)}>
          <summary>
            {t('update.log')}
            {data.running && <span className="hint"> · {t('update.running')}</span>}
            {!data.running && data.last_run?.result === 'ok' && <span className="ok"> · {t('update.ok')}</span>}
            {!data.running && data.last_run?.result === 'failed' && <span className="error"> · {t('update.failed')}</span>}
          </summary>
          {data.last_run && <pre className="console update-log">{data.last_run.log.join('\n')}</pre>}
        </details>
      )}
    </section>
  )
}

function Commit({ commit }: { commit: PendingCommit }) {
  const t = useT()
  return (
    <li>
      <div><b>{commit.subject}</b></div>
      <div className="hint"><code>{commit.short}</code> · {commit.author} · {longDate(commit.time)}</div>
      {commit.body && <pre className="commit-body">{commit.body}</pre>}
      {commit.files.length > 0 && (
        <details>
          <summary>{t('update.files', { n: commit.files.length })}</summary>
          <ul className="files">
            {commit.files.map(f => (
              <li key={f.path}><span className={`fstat s-${f.status}`}>{f.status}</span> {f.path}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}
