import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type LogLine } from '../api'
import { subscribe } from '../stream'
import { clockSeconds } from '../format'
import { useT } from '../i18n'

const MAX_LINES = 3000

export default function Logs() {
  const t = useT()
  const [lines, setLines] = useState<LogLine[]>([])
  const [showDebug, setShowDebug] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // everything kept on subscribing (and after the app restarts), then each line as it is written
  useEffect(() => subscribe('logs', message => {
    if (message.kind === 'snapshot') setLines(message.lines.slice(-MAX_LINES))
    else setLines(prev => [...prev, ...message.lines].slice(-MAX_LINES))
  }), [])

  useLayoutEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, showDebug])

  const shown = showDebug ? lines : lines.filter(l => l.level !== 'debug' && l.level !== 'trace')

  return (
    <>
      <section>
        <h2>{t('logs.title')}</h2>
        <div className="row">
          <label className="field check"><input type="checkbox" checked={showDebug}
            onChange={e => setShowDebug(e.target.checked)} /><span>{t('logs.debug')}</span></label>
          <span className="hint">{t('logs.hint', { n: MAX_LINES })}</span>
        </div>
        <div className="console" ref={box}
          onScroll={e => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
          }}>
          {shown.map(l => (
            <div key={l.seq} className={`line ${l.level} ${l.source}`}>
              <span className="time">{clockSeconds(l.time)}</span>
              <span className="level">{l.source === 'app' ? 'app' : l.level}</span>
              <span className="text">{l.text}</span>
            </div>
          ))}
        </div>
      </section>
      <GeneratedConfig />
    </>
  )
}

function GeneratedConfig() {
  const t = useT()
  const [text, setText] = useState('')
  return (
    <section>
      <details onToggle={e => {
        if ((e.target as HTMLDetailsElement).open) {
          api.getSatdumpConfig().then(c => setText(JSON.stringify(c, null, 2)), e => setText(String(e)))
        }
      }}>
        <summary>{t('logs.generated')}</summary>
        <pre className="console">{text || t('common.loading')}</pre>
      </details>
    </section>
  )
}
