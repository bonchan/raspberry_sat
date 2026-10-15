import { useState } from 'react'
import { api, ApiError, type ReceiverTest as Result, type Sdr } from './api'
import { useT, type Key } from './i18n'

const ICON = { ok: '✓', warn: '!', fail: '✗' }

/** "Test receiver" under Settings → Receiver: runs the backend test for this receiver type. */
export default function ReceiverTest({ sdr }: { sdr: Sdr }) {
  const t = useT()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setRunning(true); setError(''); setResult(null)
    try {
      setResult(await api.testReceiver(sdr))
    } catch (e) {
      setError(e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="receiver-test">
      <div className="row">
        <button disabled={running} onClick={run}>{running ? t('test.running') : t('test.button')}</button>
        <span className="hint">{t('test.hint')}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {result && !result.supported && <p className="hint">{t('test.unsupported', { source: result.source })}</p>}
      {result?.supported && (
        <>
          <p className={result.ok ? 'ok' : 'error'}><b>{result.ok ? t('test.ok') : t('test.problems')}</b></p>
          <ul className="checks">
            {result.checks.map(c => (
              <li key={c.id} className={c.status}>
                <span className="icon">{ICON[c.status]}</span>
                <span>
                  <b>{t(`test.check.${c.id}` as Key)}</b>{c.detail && <> · {c.detail}</>}
                  {c.reason && <div className="hint">{t(`test.reason.${c.reason}` as Key)}</div>}
                </span>
              </li>
            ))}
          </ul>
          {result.gains.length > 0 && (
            <div className="gains">
              <small>{t('test.gains')}</small>
              <div>
                {result.gains.map(g => (
                  <span key={g} className={g === result.effective_gain ? 'step on' : 'step'}>{g.toFixed(1)}</span>
                ))}
              </div>
              {result.effective_gain !== null && result.effective_gain !== sdr.gain && (
                <p className="hint">{t('test.gainUsed', { used: result.effective_gain.toFixed(1), set: sdr.gain })}</p>
              )}
            </div>
          )}
          {result.output && (
            <details>
              <summary>{t('test.output')}</summary>
              <pre className="console update-log">{result.output}</pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}
