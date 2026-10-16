import { NavLink, Outlet } from 'react-router-dom'
import { api } from './api'
import { useNow, usePolling } from './hooks'
import { useT, type Key } from './i18n'
import { clock } from './format'

const links: { to: string; label: Key; end?: boolean }[] = [
  { to: '/', label: 'nav.upcoming', end: true },
  { to: '/live', label: 'nav.live' },
  { to: '/passes', label: 'nav.passes' },
  { to: '/status', label: 'nav.status' },
  { to: '/settings', label: 'nav.settings' },
  { to: '/logs', label: 'nav.logs' },
]

// its own component, so only the clock re-renders every second
function Clock() {
  const t = useT()
  const now = useNow()
  return (
    <span className="clock">
      <b>{new Date(now * 1000).toISOString().slice(11, 19)} UTC</b>
      <span className="hint">{t('clock.local', { time: clock(now) })}</span>
    </span>
  )
}

// shown only when the last check found new commits upstream
function UpdateBadge() {
  const t = useT()
  const { data } = usePolling(api.getUpdate, 10 * 60 * 1000)
  if (!data?.behind && !data?.running) return null
  return <NavLink className="badge" to="/status#updates">{t('update.badge')}</NavLink>
}

// nothing while SatDump runs; red when it doesn't, or when the Pi does not answer
function SatdumpBadge() {
  const t = useT()
  const { data, error } = usePolling(api.getStatus, 5000)
  const state = data?.satdump.state
  if (error) return <NavLink className="badge danger" to="/status">{t('header.offline')}</NavLink>
  if (!state || state === 'running') return null
  return <NavLink className="badge danger" to="/status">SatDump: {t(`state.${state}` as Key)}</NavLink>
}

export default function Layout() {
  const t = useT()
  return (
    <>
      <header className="topbar">
        <span className="brand">raspberry_sat</span>
        <nav>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}>{t(l.label)}</NavLink>
          ))}
        </nav>
        <div className="badges">
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
