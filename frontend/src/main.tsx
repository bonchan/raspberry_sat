import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { LanguageContext, setCurrentLanguage, type Lang } from './i18n'
import { ConfirmProvider } from './Dialog'
import Layout from './Layout'
import Upcoming from './pages/Upcoming'
import Status from './pages/Status'
import Live from './pages/Live'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Settings from './pages/Settings'
import Logs from './pages/Logs'
import Networks from './pages/Networks'
import { store, stored } from './storage'
import './styles.css'

// the last language this browser used, so the page doesn't flash English while the settings load
const storedLanguage = (): Lang => (stored('language') === 'es' ? 'es' : 'en')

function App() {
  const [lang, setLangState] = useState<Lang>(storedLanguage)
  setCurrentLanguage(lang)      // for the date formatting in format.ts

  function setLang(next: Lang) {
    setCurrentLanguage(next)
    setLangState(next)
    store('language', next)
  }

  useEffect(() => {
    api.getConfig().then(c => setLang(c.display.language), () => {})
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Upcoming />} />
              <Route path="status" element={<Status />} />
              <Route path="live" element={<Live />} />
              <Route path="passes" element={<Passes />} />
              <Route path="passes/:id" element={<PassDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="logs" element={<Logs />} />
              <Route path="networks" element={<Networks />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </LanguageContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
