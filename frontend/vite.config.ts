import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` forwards /api to the backend. Default is a backend on this machine;
// set API_TARGET (in .env.local or the shell) to use the Pi's, e.g. http://sat.local:8000
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    server: {
      proxy: { '/api': env.API_TARGET || 'http://localhost:8000' },
    },
  }
})
