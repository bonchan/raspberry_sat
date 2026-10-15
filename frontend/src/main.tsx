import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import Status from './pages/Status'
import Passes from './pages/Passes'
import PassDetail from './pages/PassDetail'
import Settings from './pages/Settings'
import Logs from './pages/Logs'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Status />} />
          <Route path="passes" element={<Passes />} />
          <Route path="passes/:id" element={<PassDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
