import { NavLink, Outlet } from 'react-router-dom'
import { useNow } from './hooks'
import { useT, type Key } from './i18n'
import { clock } from './format'

const links: { to: string; label: Key; end?: boolean }[] = [
  { to: '/', label: 'nav.status', end: true },
  { to: '/live', label: 'nav.live' },
  { to: '/passes', label: 'nav.passes' },
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
        <Clock />
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
