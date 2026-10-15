import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type LogLine } from '../api'

const MAX_LINES = 3000

export default function Logs() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [showDebug, setShowDebug] = useState(false)
  const last = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    async function poll() {
      try {
        const r = await api.getLogs(last.current)
        if (!alive) return
        if (r.last < last.current) {            // the app restarted: its numbering starts over
          last.current = 0
          setLines([])
        } else if (r.lines.length) {
          last.current = r.last
          setLines(prev => [...prev, ...r.lines].slice(-MAX_LINES))
        }
      } catch { /* backend restarting; try again */ }
      if (alive) timer = window.setTimeout(poll, 2000)
    }
    poll()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])

  useLayoutEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, showDebug])

  const shown = showDebug ? lines : lines.filter(l => l.level !== 'debug' && l.level !== 'trace')

  return (
    <>
      <section>
        <h2>SatDump log</h2>
        <div className="row">
          <label className="field check"><input type="checkbox" checked={showDebug}
            onChange={e => setShowDebug(e.target.checked)} /><span>Debug lines</span></label>
          <span className="hint">Last {MAX_LINES} lines. The full log is in logs/satdump.log in the data folder.</span>
        </div>
        <div className="console" ref={box}
          onScroll={e => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
          }}>
          {shown.map(l => (
            <div key={l.seq} className={`line ${l.level} ${l.source}`}>
              <span className="time">{new Date(l.time * 1000).toLocaleTimeString()}</span>
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
  const [text, setText] = useState('')
  return (
    <section>
      <details onToggle={e => {
        if ((e.target as HTMLDetailsElement).open) {
          api.getSatdumpConfig().then(c => setText(JSON.stringify(c, null, 2)), e => setText(String(e)))
        }
      }}>
        <summary>SatDump configuration generated from the settings</summary>
        <pre className="console">{text || 'Loading…'}</pre>
      </details>
    </section>
  )
}
