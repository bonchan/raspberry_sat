import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { api, ApiError, type Me } from './api'
import {
  initialLanguage, LANGUAGES, LanguageContext, setCurrentLanguage, storeLanguage, useLanguage, useT, type Lang,
} from './i18n'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Receivers from './pages/Receivers'
import Users from './pages/Users'

async function signOut() {
  try {
    await api.signOut()
  } finally {
    location.href = '/'
  }
}

/** English / Español, as chips */
function LanguageChoice() {
  const { lang, setLang } = useLanguage()
  return (
    <div className="chips">
      {LANGUAGES.map(l => (
        <button key={l.code} className={lang === l.code ? 'chip on' : 'chip'} onClick={() => setLang(l.code)}>{l.name}</button>
      ))}
    </div>
  )
}

/** Not signed in: the only way in is Google. */
function SignIn() {
  const t = useT()
  const result = new URLSearchParams(location.search).get('signin')
  return (
    <main>
      <section className="signin narrow">
        <h2>raspberry_sat hub</h2>
        <p>{t('signin.what')}</p>
        <button className="primary" onClick={() => location.assign('/auth/login')}>{t('signin.google')}</button>
        {result && <p className={result === 'cancelled' ? 'hint' : 'error'}>
          {result === 'cancelled' ? t('signin.cancelled') : t('signin.failed', { error: result })}
        </p>}
        <LanguageChoice />
        {/* a plain link: the page is a static file (web/public), outside the app's routes */}
        <a className="hint" href="/privacy.html">{t('signin.privacy')}</a>
      </section>
    </main>
  )
}

/** Signed in, but no admin has given them a role yet. */
function Waiting({ me }: { me: Me }) {
  const t = useT()
  return (
    <main>
      <section className="signin narrow">
        <h2>raspberry_sat hub</h2>
        <p>{t('waiting.signedInAs')} <b>{me.email}</b>.</p>
        <p className="hint">{t('waiting.ask')}</p>
        <LanguageChoice />
        <button onClick={signOut}>{t('menu.signOut')}</button>
      </section>
    </main>
  )
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
          <div className="menu-label">{t('menu.language')}</div>
          <LanguageChoice />
          <button onClick={signOut}>{t('menu.signOut')}</button>
        </div>
      )}
    </div>
  )
}

function Layout({ me }: { me: Me }) {
  const t = useT()
  return (
    <>
      <header className="topbar">
        <span className="brand">raspberry_sat hub</span>
        <nav>
          <NavLink to="/" end>{t('nav.passes')}</NavLink>
          {me.role === 'admin' && <NavLink to="/receivers">{t('nav.receivers')}</NavLink>}
          {me.role === 'admin' && <NavLink to="/users">{t('nav.users')}</NavLink>}
        </nav>
        <UserMenu me={me} />
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

function NotFound() {
  const t = useT()
  return <section><p>{t('app.notFound')} <NavLink to="/">{t('common.allPasses')}</NavLink></p></section>
}

function Hub() {
  const t = useT()
  const [me, setMe] = useState<Me | null | undefined>(undefined)     // undefined: asking; null: signed out
  const [error, setError] = useState('')

  useEffect(() => {
    api.me().then(setMe, e => (e instanceof ApiError && e.status === 401 ? setMe(null) : setError(e.message)))
  }, [])

  if (error) return <main><p className="error">{t('app.notAnswering', { error })}</p></main>
  if (me === undefined) return <main><p className="hint">{t('common.loading')}</p></main>
  if (me === null) return <SignIn />
  if (me.role === 'pending') return <Waiting me={me} />
  const admin = me.role === 'admin'
  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        <Route index element={<Passes admin={admin} />} />
        <Route path="passes/:id" element={<PassDetail admin={admin} />} />
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
