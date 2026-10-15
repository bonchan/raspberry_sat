import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { LanguageContext, setCurrentLanguage, type Lang } from './i18n'
import Layout from './Layout'
import Status from './pages/Status'
import Live from './pages/Live'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Settings from './pages/Settings'
import Logs from './pages/Logs'
import Update from './pages/Update'
import './styles.css'

const STORED_LANGUAGE = 'rsat-language'

// the last language this browser used, so the page doesn't flash English while the settings load
function storedLanguage(): Lang {
  try {
    return localStorage.getItem(STORED_LANGUAGE) === 'es' ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

function App() {
  const [lang, setLangState] = useState<Lang>(storedLanguage)
  setCurrentLanguage(lang)      // for the date formatting in format.ts

  function setLang(next: Lang) {
    setCurrentLanguage(next)
    setLangState(next)
    try { localStorage.setItem(STORED_LANGUAGE, next) } catch { /* private mode */ }
  }

  useEffect(() => {
    api.getConfig().then(c => setLang(c.display.language), () => {})
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Status />} />
            <Route path="live" element={<Live />} />
            <Route path="passes" element={<Passes />} />
            <Route path="passes/:id" element={<PassDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="logs" element={<Logs />} />
            <Route path="update" element={<Update />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LanguageContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
