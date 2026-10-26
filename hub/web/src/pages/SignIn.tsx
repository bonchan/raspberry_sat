import { useEffect, useState } from 'react'
import { api, type PassDetail as Pass } from '../api'
import { LANGUAGES, useLanguage, useT } from '../i18n'
import PassView from '../PassView'

/** English / Español, as chips */
export function LanguageChoice() {
  const { lang, setLang } = useLanguage()
  return (
    <div className="chips">
      {LANGUAGES.map(l => (
        <button key={l.code} className={lang === l.code ? 'chip on' : 'chip'} onClick={() => setLang(l.code)}>{l.name}</button>
      ))}
    </div>
  )
}

/** The newest pass with all its data (what signing in shows) and, on its right, "Sign in with Google": the
    only way in. */
export default function SignIn() {
  const t = useT()
  const result = new URLSearchParams(location.search).get('signin')
  const [latest, setLatest] = useState<Pass | null | undefined>(undefined)     // undefined: asking

  useEffect(() => {
    let alive = true
    api.latest().then(p => alive && setLatest(p), () => alive && setLatest(null))
    return () => { alive = false }
  }, [])

  if (latest === undefined) return <p className="hint">{t('common.loading')}</p>
  const box = (
    <section className={latest ? 'signin' : 'signin narrow alone'}>
      <h2>raspberry_sat hub</h2>
      <p>{t('signin.what')}</p>
      <p className="hint">{t('signin.more')}</p>
      <button className="primary" onClick={() => location.assign('/auth/login')}>{t('signin.google')}</button>
      {result && <p className={result === 'cancelled' ? 'hint' : 'error'}>
        {result === 'cancelled' ? t('signin.cancelled') : t('signin.failed', { error: result })}
      </p>}
      <LanguageChoice />
      {/* a plain link: the page is a static file (web/public), outside the app's routes */}
      <a className="hint" href="/privacy.html">{t('signin.privacy')}</a>
    </section>
  )
  // no pass yet (a new hub): only the box
  return latest ? <PassView pass={latest} chart={latest.chart ?? null} label={t('signin.latest')} aside={box} /> : box
}
