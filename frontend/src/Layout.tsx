import { NavLink, Outlet } from 'react-router-dom'
import { useNow } from './hooks'

const links = [
  { to: '/', label: 'Status', end: true },
  { to: '/live', label: 'Live' },
  { to: '/passes', label: 'Passes' },
  { to: '/settings', label: 'Settings' },
  { to: '/logs', label: 'Logs' },
]

// its own component, so only the clock re-renders every second
function Clock() {
  const now = new Date(useNow() * 1000)
  return (
    <span className="clock">
      <b>{now.toISOString().slice(11, 19)} UTC</b>
      <span className="hint">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local</span>
    </span>
  )
}

export default function Layout() {
  return (
    <>
      <header className="topbar">
        <span className="brand">raspberry_sat</span>
        <nav>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
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
