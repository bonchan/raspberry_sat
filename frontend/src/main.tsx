import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import Status from './pages/Status'
import Settings from './pages/Settings'
import Placeholder from './pages/Placeholder'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Status />} />
          <Route path="passes" element={<Placeholder title="Passes" step="3" />} />
          <Route path="settings" element={<Settings />} />
          <Route path="logs" element={<Placeholder title="Logs" step="2" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
