/// <reference types="node" />
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// CesiumJS (the Live page's globe) is used prebuilt, not bundled: its Build/Cesium folder (script, workers,
// the offline Natural Earth II imagery) is copied to public/cesium, served as /cesium and loaded only when the
// globe opens. Copied again only when the cesium package's version changes.
function cesiumStatic(): Plugin {
  return {
    name: 'cesium-static',
    buildStart() {
      const version = JSON.parse(readFileSync('node_modules/cesium/package.json', 'utf8')).version as string
      const stamp = 'public/cesium/.version'
      if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) return
      rmSync('public/cesium', { recursive: true, force: true })
      cpSync('node_modules/cesium/Build/Cesium', 'public/cesium', { recursive: true })
      writeFileSync(stamp, version)
    },
  }
}

// `pnpm dev` forwards /api to the backend. Default is a backend on this machine;
// set API_TARGET (in .env.local or the shell) to use the Pi's, e.g. http://sat.local:8000
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), cesiumStatic()],
    server: {
      // ws: the pages' live data comes over a WebSocket (/api/ws)
      proxy: { '/api': { target: env.API_TARGET || 'http://localhost:8000', ws: true } },
    },
  }
})
