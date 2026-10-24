import { useEffect, useRef, type CSSProperties } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useNow } from './hooks'
import { useT, type Key } from './i18n'
import { useConnection, useTopic } from './stream'
import { clockSeconds, utcClock } from './format'

const links: { to: string; label: Key; end?: boolean }[] = [
  { to: '/', label: 'nav.upcoming', end: true },
  { to: '/live', label: 'nav.live' },
  { to: '/passes', label: 'nav.passes' },
  { to: '/status', label: 'nav.status' },
  { to: '/settings', label: 'nav.settings' },
  { to: '/logs', label: 'nav.logs' },
]

// its own component, so only the clock re-renders every second. Local time unmarked, UTC marked, as everywhere else
function Clock() {
  const now = useNow()
  return (
    <span className="clock">
      <b>{clockSeconds(now)}</b>
      <span className="hint">{utcClock(now)} UTC</span>
    </span>
  )
}

// shown only when the last check found new commits upstream that change something the Pi uses
function UpdateBadge() {
  const t = useT()
  const data = useTopic('update')
  if (!data?.pi_changes && !data?.running) return null
  return <NavLink className="badge" to="/status#updates">{t('update.badge')}</NavLink>
}

// a pass being worked on after LOS, how far it is; the Live page shows it itself
function ProcessingBadge() {
  const t = useT()
  const processing = useTopic('processing')
  const { pathname } = useLocation()
  if (!processing || pathname.startsWith('/live')) return null
  const p = processing.percent
  return (
    <NavLink className="badge processing" to="/live" style={{ '--p': `${p ?? 0}%` } as CSSProperties}
      title={`${processing.satellite ?? processing.pass}: ${t(`processing.${processing.step}`)}`}>
      {t('header.processing', { p: p === null ? '…' : `${p}%` })}
    </NavLink>
  )
}

// nothing while SatDump runs; red when it doesn't, or when the Pi does not answer
function SatdumpBadge() {
  const t = useT()
  const process = useTopic('satdump')
  const connection = useConnection()
  const state = process?.state
  if (connection === 'down') return <NavLink className="badge danger" to="/status">{t('header.offline')}</NavLink>
  if (!state || state === 'running') return null
  return <NavLink className="badge danger" to="/status">SatDump: {t(`state.${state}` as Key)}</NavLink>
}

export default function Layout() {
  const t = useT()
  const header = useRef<HTMLElement>(null)

  // the header sticks to the top; what sticks under it (sky plot, save bar) needs its height, which
  // changes as the nav wraps or a badge shows up
  useEffect(() => {
    const el = header.current
    if (!el) return
    const measure = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <header className="topbar" ref={header}>
        <span className="brand">raspberry_sat</span>
        <nav>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}>{t(l.label)}</NavLink>
          ))}
        </nav>
        <div className="badges">
          <ProcessingBadge />
          <UpdateBadge />
          <SatdumpBadge />
        </div>
        <Clock />
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
