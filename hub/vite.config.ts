import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// CesiumJS (the globe layout of Passes) is used prebuilt, not bundled, as in the station app: its
// Build/Cesium folder is copied to web/public/cesium, served as /cesium and loaded only when the globe opens.
// Copied again only when the cesium package's version changes.
function cesiumStatic(): Plugin {
  return {
    name: 'cesium-static',
    buildStart() {
      const version = JSON.parse(readFileSync('node_modules/cesium/package.json', 'utf8')).version as string
      const stamp = 'web/public/cesium/.version'
      if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) return
      rmSync('web/public/cesium', { recursive: true, force: true })
      cpSync('node_modules/cesium/Build/Cesium', 'web/public/cesium', { recursive: true })
      writeFileSync(stamp, version)
    },
  }
}

// The gallery's pages (web/) are built into dist/, which the Worker serves as static files (wrangler.jsonc).
// They share the station app's stylesheet (../frontend/src/styles.css), so both look the same, and its
// Cesium and chart drawing (frontend/src/cesium.ts, signalPlot.ts: no React in them, nothing to install).
export default defineConfig({
  root: 'web',
  plugins: [react(), cesiumStatic()],
  build: { outDir: '../dist', emptyOutDir: true },
})
