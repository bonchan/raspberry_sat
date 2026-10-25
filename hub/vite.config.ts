import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The gallery's pages (web/) are built into dist/, which the Worker serves as static files (wrangler.jsonc).
// They share the station app's stylesheet (../frontend/src/styles.css), so both look the same.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
})
