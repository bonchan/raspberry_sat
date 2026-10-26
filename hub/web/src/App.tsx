import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, type Me } from './api'
import { initialLanguage, LanguageContext, setCurrentLanguage, storeLanguage, useT, type Lang } from './i18n'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Receivers from './pages/Receivers'
import SignIn, { LanguageChoice } from './pages/SignIn'
import Users from './pages/Users'

async function signOut() {
  try {
    await api.signOut()
  } finally {
    location.href = '/'
  }
}

/** In the header: who is signed in; opens a menu with the language and Sign out. */
function UserMenu({ me }: { me: Me }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // a click elsewhere or Escape closes it
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', click)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="badges user-menu" ref={box}>
      <button className="user-button" aria-haspopup="menu" aria-expanded={open} title={t('menu.open')}
        onClick={() => setOpen(!open)}>
        {me.picture
          ? <img src={me.picture} alt="" referrerPolicy="no-referrer" />
          : <span className="avatar">{(me.name || me.email).slice(0, 1).toUpperCase()}</span>}
        <span className="user-name">{me.name || me.email}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="hint">{me.email}</div>
          {me.role === 'pending' && <div className="hint">{t('waiting.short')}</div>}
          <div className="menu-label">{t('menu.language')}</div>
          <LanguageChoice />
          <button onClick={signOut}>{t('menu.signOut')}</button>
        </div>
      )}
    </div>
  )
}

/** The header and the page. Signed out: a Sign in button where the user menu would be. */
function Layout({ me }: { me: Me | null }) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <>
      <header className="topbar">
        <span className="brand">raspberry_sat hub</span>
        <nav>
          <NavLink to="/" end>{t('nav.passes')}</NavLink>
          {me?.role === 'admin' && <NavLink to="/receivers">{t('nav.receivers')}</NavLink>}
          {me?.role === 'admin' && <NavLink to="/users">{t('nav.users')}</NavLink>}
        </nav>
        {me
          ? <UserMenu me={me} />
          : <div className="badges">
              {pathname !== '/signin' && <button className="primary" onClick={() => navigate('/signin')}>{t('menu.signIn')}</button>}
            </div>}
      </header>
      <main>
        {me?.role === 'pending' && <p className="hint">{t('waiting.notice', { email: me.email })}</p>}
        <Outlet />
      </main>
    </>
  )
}

function NotFound() {
  const t = useT()
  return <section><p>{t('app.notFound')} <NavLink to="/">{t('common.allPasses')}</NavLink></p></section>
}

/** Anyone can look; signing in (as viewer or admin) shows everything. */
function Hub() {
  const t = useT()
  const [me, setMe] = useState<Me | null | undefined>(undefined)     // undefined: asking; null: signed out
  const [error, setError] = useState('')

  useEffect(() => {
    api.me().then(setMe, e => (e instanceof ApiError && e.status === 401 ? setMe(null) : setError(e.message)))
  }, [])

  if (error) return <main><p className="error">{t('app.notAnswering', { error })}</p></main>
  if (me === undefined) return <main><p className="hint">{t('common.loading')}</p></main>
  const admin = me?.role === 'admin'
  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        <Route index element={<Passes admin={admin} />} />
        <Route path="passes/:id" element={<PassDetail me={me} />} />
        <Route path="signin" element={me ? <Navigate to="/" replace /> : <SignIn />} />
        {admin && <Route path="receivers" element={<Receivers />} />}
        {admin && <Route path="users" element={<Users me={me} />} />}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLanguage)
  setCurrentLanguage(lang)        // for the dates in format.ts

  function setLang(next: Lang) {
    setCurrentLanguage(next)
    setLangState(next)
    storeLanguage(next)
  }

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <Hub />
    </LanguageContext.Provider>
  )
}
