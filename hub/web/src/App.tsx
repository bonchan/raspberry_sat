import { useEffect, useState } from 'react'
import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { api, ApiError, type Me } from './api'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Stations from './pages/Stations'
import Users from './pages/Users'

async function signOut() {
  try {
    await api.signOut()
  } finally {
    location.href = '/'
  }
}

/** Not signed in: the only way in is Google. */
function SignIn() {
  const result = new URLSearchParams(location.search).get('signin')
  return (
    <main>
      <section className="signin narrow">
        <h2>raspberry_sat hub</h2>
        <p>Satellite images from the stations.</p>
        <button className="primary" onClick={() => location.assign('/auth/login')}>Sign in with Google</button>
        {result && <p className={result === 'cancelled' ? 'hint' : 'error'}>
          {result === 'cancelled' ? 'Sign-in was cancelled.' : `Sign-in failed: ${result}`}
        </p>}
        {/* a plain link: the page is a static file (web/public), outside the app's routes */}
        <a className="hint" href="/privacy.html">Privacy</a>
      </section>
    </main>
  )
}

/** Signed in, but no admin has given them a role yet. */
function Waiting({ me }: { me: Me }) {
  return (
    <main>
      <section className="signin narrow">
        <h2>raspberry_sat hub</h2>
        <p>Signed in as <b>{me.email}</b>.</p>
        <p className="hint">An admin has to let you in. Ask them, then reload this page.</p>
        <button onClick={signOut}>Sign out</button>
      </section>
    </main>
  )
}

function Layout({ me }: { me: Me }) {
  return (
    <>
      <header className="topbar">
        <span className="brand">raspberry_sat hub</span>
        <nav>
          <NavLink to="/" end>Passes</NavLink>
          {me.role === 'admin' && <NavLink to="/stations">Stations</NavLink>}
          {me.role === 'admin' && <NavLink to="/users">Users</NavLink>}
        </nav>
        <div className="badges user">
          {me.picture && <img src={me.picture} alt="" referrerPolicy="no-referrer" />}
          <span className="hint" title={me.email}>{me.name || me.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

function NotFound() {
  return <section><p>Nothing here. <NavLink to="/">All passes</NavLink></p></section>
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)     // undefined: asking; null: signed out
  const [error, setError] = useState('')

  useEffect(() => {
    api.me().then(setMe, e => (e instanceof ApiError && e.status === 401 ? setMe(null) : setError(e.message)))
  }, [])

  if (error) return <main><p className="error">The hub is not answering: {error}</p></main>
  if (me === undefined) return <main><p className="hint">Loading…</p></main>
  if (me === null) return <SignIn />
  if (me.role === 'pending') return <Waiting me={me} />
  const admin = me.role === 'admin'
  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        <Route index element={<Passes admin={admin} />} />
        <Route path="passes/:id" element={<PassDetail admin={admin} />} />
        {admin && <Route path="stations" element={<Stations />} />}
        {admin && <Route path="users" element={<Users me={me} />} />}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
