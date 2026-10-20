// A CesiumJS globe with the satellites in the settings where they are now, their next orbit and the
// station. Offline: the imagery is Natural Earth II, which ships with CesiumJS; no Cesium ion.
// CesiumJS is not bundled: its prebuilt script is loaded from /cesium (see vite.config.ts) the first
// time a globe opens, so the other pages don't carry it. Only types are imported from 'cesium' here.

import { useEffect, useRef, useState } from 'react'
import type { Cartesian3, Viewer } from 'cesium'
import { eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js'
import { api, type TleSet } from './api'
import { usePolling } from './hooks'
import { useT } from './i18n'

type CesiumNS = typeof import('cesium')

declare global {
  interface Window { Cesium?: CesiumNS; CESIUM_BASE_URL?: string }
}

const BASE = '/cesium/'
const ORBIT_STEP = 30           // seconds between points of the next-orbit line
const ORBIT_REFRESH = 60_000    // ms; the line starts at the satellite, so it is redrawn now and then
const COLORS = { station: '#3ecf8e', satellite: '#4da3ff', receiving: '#ffd23f', disabled: '#8b93a1' }

let loading: Promise<CesiumNS> | null = null

function loadCesium(): Promise<CesiumNS> {
  loading ??= new Promise<CesiumNS>((resolve, reject) => {
    window.CESIUM_BASE_URL = BASE
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${BASE}Widgets/widgets.css`
    document.head.appendChild(css)
    const script = document.createElement('script')
    script.src = `${BASE}Cesium.js`
    script.onload = () => (window.Cesium ? resolve(window.Cesium) : reject(new Error('Cesium.js did not define Cesium')))
    script.onerror = () => {
      loading = null
      reject(new Error(`could not load ${script.src}`))
    }
    document.head.appendChild(script)
  })
  return loading
}

function createViewer(C: CesiumNS, el: HTMLElement): Viewer {
  const viewer = new C.Viewer(el, {
    baseLayer: C.ImageryLayer.fromProviderAsync(
      C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII'))),
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false,
    targetFrameRate: 30,
  })
  viewer.clock.shouldAnimate = true             // real time, so day and night move with the satellites
  viewer.scene.globe.enableLighting = true
  return viewer
}

/** Where the satellite is at `date`, Earth-fixed, in metres; undefined when the orbit can't be worked out. */
function positionAt(C: CesiumNS, rec: SatRec, date: Date): Cartesian3 | undefined {
  const pv = propagate(rec, date)
  if (!pv) return undefined
  const ecf = eciToEcf(pv.position, gstime(date))
  return new C.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000)
}

/** One orbit ahead of now: where it will pass over the ground. */
function nextOrbit(C: CesiumNS, rec: SatRec): Cartesian3[] {
  const period = (2 * Math.PI / rec.no) * 60      // rec.no: mean motion in radians per minute
  const now = Date.now()
  const points: Cartesian3[] = []
  for (let s = 0; s <= period; s += ORBIT_STEP) {
    const p = positionAt(C, rec, new Date(now + s * 1000))
    if (p) points.push(p)
  }
  return points
}

function showSatellites(C: CesiumNS, viewer: Viewer, tles: TleSet, highlight?: number) {
  const label = (text: string) => ({
    text, font: '13px sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
    style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -12),
  })
  const { station } = tles
  viewer.entities.add({
    position: C.Cartesian3.fromDegrees(station.lon, station.lat, station.alt),
    point: { pixelSize: 8, color: C.Color.fromCssColorString(COLORS.station), outlineColor: C.Color.BLACK, outlineWidth: 1 },
    label: label(station.name),
  })
  for (const sat of tles.satellites) {
    const rec = twoline2satrec(sat.line1, sat.line2)
    const receiving = sat.norad === highlight
    const color = C.Color.fromCssColorString(receiving ? COLORS.receiving : sat.enabled ? COLORS.satellite : COLORS.disabled)
    let orbit: Cartesian3[] = []
    let orbitAt = 0
    viewer.entities.add({
      position: new C.CallbackPositionProperty(() => positionAt(C, rec, new Date()), false),
      point: { pixelSize: receiving ? 12 : 9, color, outlineColor: C.Color.BLACK, outlineWidth: 2 },
      label: label(sat.name),
      polyline: {
        positions: new C.CallbackProperty(() => {
          if (Date.now() - orbitAt > ORBIT_REFRESH) {
            orbit = nextOrbit(C, rec)
            orbitAt = Date.now()
          }
          return orbit
        }, false),
        width: receiving ? 2 : 1.5, arcType: C.ArcType.NONE, material: color.withAlpha(0.55),
      },
    })
  }
}

/** highlight: the NORAD number of the satellite being received, drawn in yellow like on the sky plot. */
export default function Globe({ highlight }: { highlight?: number }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const aimed = useRef(false)
  const [cesium, setCesium] = useState<CesiumNS | null>(null)
  const [failed, setFailed] = useState('')
  const { data: tles } = usePolling(api.getTles, 60 * 60 * 1000)     // SatDump refreshes them daily

  useEffect(() => {
    let alive = true
    loadCesium().then(C => {
      if (!alive || !box.current) return
      viewer.current = createViewer(C, box.current)
      setCesium(C)
    }, e => { if (alive) setFailed(e instanceof Error ? e.message : String(e)) })
    return () => {
      alive = false
      viewer.current?.destroy()
      viewer.current = null
      aimed.current = false
    }
  }, [])

  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v || !tles) return
    if (!aimed.current) {         // start above the station, far enough out to see the whole hemisphere
      v.camera.setView({ destination: cesium.Cartesian3.fromDegrees(tles.station.lon, tles.station.lat, 15_000_000) })
      aimed.current = true
    }
    showSatellites(cesium, v, tles, highlight)
    return () => { if (!v.isDestroyed()) v.entities.removeAll() }
  }, [cesium, tles, highlight])

  return (
    <div className="globe">
      <div ref={box} className="globe-canvas" />
      {!cesium && <p className="globe-wait hint">{failed ? t('globe.failed', { error: failed }) : t('globe.loading')}</p>}
      {tles && tles.missing.length > 0 && <p className="globe-note hint">{t('globe.missing', { list: tles.missing.join(', ') })}</p>}
    </div>
  )
}
