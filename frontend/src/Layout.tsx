import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'Status', end: true },
  { to: '/passes', label: 'Passes' },
  { to: '/settings', label: 'Settings' },
  { to: '/logs', label: 'Logs' },
]

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
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
