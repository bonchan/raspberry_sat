// A CesiumJS globe with the satellites in the settings where they are now, their next orbit, the
// station, and the last pass's image draped where it was taken (/api/passes/{id}/geo, georef.py).
// Offline: the imagery is Natural Earth II, which ships with CesiumJS; no Cesium ion.
// CesiumJS is not bundled: its prebuilt script is loaded from /cesium (see vite.config.ts) the first
// time a globe opens, so the other pages don't carry it. Only types are imported from 'cesium' here.

import { useEffect, useRef, useState } from 'react'
import type { BoundingSphere, Cartesian3, Primitive, Viewer } from 'cesium'
import { eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js'
import { api, passFile, type PassGeo, type PassSummary, type TleSet } from './api'
import { usePolling } from './hooks'
import { useT } from './i18n'

type CesiumNS = typeof import('cesium')

declare global {
  interface Window { Cesium?: CesiumNS; CESIUM_BASE_URL?: string }
}

const BASE = '/cesium/'
const ORBIT_STEP = 30           // seconds between points of the next-orbit line
const ORBIT_REFRESH = 60_000    // ms; the line starts at the satellite, so it is redrawn now and then
const COLORS = { station: '#3ecf8e', satellite: '#4da3ff', receiving: '#ffd23f' }
const IMAGE_HEIGHT = 5000       // metres above the ground for a draped image: clear of the globe's surface
const IMAGE_STEP = 1000         // each further image a little higher, so overlapping ones don't flicker
const ON_TOP = Number.POSITIVE_INFINITY      // labels and dots drawn over the images, never hidden by them

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
    targetFrameRate: 30, scene3DOnly: true,
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

/** The station, and with `satellites` the enabled satellites in the settings where they are now and their next orbit. */
function showSatellites(C: CesiumNS, viewer: Viewer, tles: TleSet, satellites: boolean, highlight?: number) {
  const label = (text: string) => ({
    text, font: '13px sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
    style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -12),
    disableDepthTestDistance: ON_TOP,
  })
  const { station } = tles
  viewer.entities.add({
    position: C.Cartesian3.fromDegrees(station.lon, station.lat, station.alt),
    point: {
      pixelSize: 8, color: C.Color.fromCssColorString(COLORS.station), outlineColor: C.Color.BLACK, outlineWidth: 1,
      disableDepthTestDistance: ON_TOP,
    },
    label: label(station.name),
  })
  for (const sat of satellites ? tles.satellites.filter(s => s.enabled) : []) {
    const rec = twoline2satrec(sat.line1, sat.line2)
    const receiving = sat.norad === highlight
    const color = C.Color.fromCssColorString(receiving ? COLORS.receiving : COLORS.satellite)
    let orbit: Cartesian3[] = []
    let orbitAt = 0
    viewer.entities.add({
      position: new C.CallbackPositionProperty(() => positionAt(C, rec, new Date()), false),
      point: { pixelSize: receiving ? 12 : 9, color, outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: ON_TOP },
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

/** The pass's image stretched over its grid of positions: each grid cell is two triangles whose corners
    carry the matching spot of the image, so it follows the strip's curve. Cells touching a line without
    a position (no data) are left out. */
function passImage(C: CesiumNS, geo: PassGeo, picture: HTMLImageElement, altitude: number): { primitive: Primitive; sphere: BoundingSphere } | null {
  const { rows, cols, points, width, height } = geo
  const positions: number[] = [], st: number[] = [], indices: number[] = []
  const vertex = new Map<number, number>()       // grid index -> vertex index
  rows.forEach((y, i) => cols.forEach((x, j) => {
    const point = points[i * cols.length + j]
    if (!point) return
    const p = C.Cartesian3.fromDegrees(point[1], point[0], altitude)
    vertex.set(i * cols.length + j, positions.length / 3)
    positions.push(p.x, p.y, p.z)
    st.push(x / (width - 1), 1 - y / (height - 1))       // texture origin is the image's bottom left
  }))
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < cols.length; j++) {
      const corners = [i * cols.length + j, i * cols.length + j + 1, (i + 1) * cols.length + j, (i + 1) * cols.length + j + 1]
        .map(k => vertex.get(k))
      if (corners.some(v => v === undefined)) continue
      const [a, b, c, d] = corners as number[]
      indices.push(a, c, b, b, c, d)
    }
  }
  if (!indices.length) return null
  const attributes = new C.GeometryAttributes()
  attributes.position = new C.GeometryAttribute({
    componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(positions) })
  attributes.st = new C.GeometryAttribute({
    componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) })
  const geometry = new C.Geometry({
    attributes,
    indices: new Uint32Array(indices),
    primitiveType: C.PrimitiveType.TRIANGLES,
    boundingSphere: C.BoundingSphere.fromVertices(positions),
  })
  C.GeometryPipeline.computeNormal(geometry)
  const primitive = new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry }),
    appearance: new C.MaterialAppearance({
      material: C.Material.fromType('Image', { image: picture }),
      materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, flat: true, faceForward: true, translucent: false,
    }),
    asynchronous: false,
  })
  return { primitive, sphere: geometry.boundingSphere! }
}

/** An image to drape on the globe: a pass's picture and where its pixels lie. */
export interface Drape { id: string; geo: PassGeo; url: string }

const geoCache = new Map<string, Promise<PassGeo | null>>()     // per page load; null: can't be placed

/** Where these passes' images lie, in the passes' order. Passes whose image can't be placed (no
    georeferencing) are in `failed`. Each pass is asked for once per page load; while new ones load, the
    ones already known stay (ready false). */
export function usePassDrapes(passes: PassSummary[]): { drapes: Drape[]; failed: string[]; ready: boolean } {
  const key = passes.map(p => p.id).join('|')
  const [state, setState] = useState<{ key: string; drapes: Drape[]; failed: string[] }>({ key: '', drapes: [], failed: [] })
  useEffect(() => {
    let alive = true
    const ids = key ? key.split('|') : []
    Promise.all(ids.map(id => {
      let geo = geoCache.get(id)
      if (!geo) {
        geo = api.getPassGeo(id).catch(() => null)
        geoCache.set(id, geo)
      }
      return geo.then(g => ({ id, geo: g }))
    })).then(results => {
      if (!alive) return
      setState({
        key,
        drapes: results.flatMap(r => (r.geo ? [{ id: r.id, geo: r.geo, url: passFile(r.id, 'large', r.geo.image) }] : [])),
        failed: results.filter(r => !r.geo).map(r => r.id),
      })
    })
    return () => { alive = false }
  }, [key])
  if (state.key === key) return { ...state, ready: true }
  const wanted = new Set(passes.map(p => p.id))
  return { drapes: state.drapes.filter(d => wanted.has(d.id)), failed: state.failed.filter(id => wanted.has(id)), ready: false }
}

interface Props {
  size?: 'tall' | 'fill'              // tall: 800 px; fill: as tall as its row (Live during a pass)
  satellites?: boolean                // the satellites in the settings, live, with their next orbit
  highlight?: number                  // NORAD number of the one being received: yellow, like on the sky plot
  drapes?: Drape[]
  focus?: { id: string; at: number; instant?: boolean }   // fly to this drape; `at` changes when asked again
  note?: string                       // top right, e.g. which pass the image is from
  startHeight?: number                // metres above the station to start from
}

export default function Globe({ size, satellites = false, highlight, drapes = [], focus, note, startHeight = 15_000_000 }: Props) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const aimed = useRef(false)
  const placed = useRef(new Map<string, { primitive: Primitive; sphere: BoundingSphere }>())    // by drape id
  const wanted = useRef(new Set<string>())        // the drapes asked for now, also while their pictures load
  const loading = useRef(new Set<string>())
  const [placedCount, setPlacedCount] = useState(0)     // bumps when a picture arrives, to fly to it
  const [cesium, setCesium] = useState<CesiumNS | null>(null)
  const [failed, setFailed] = useState('')
  const { data: tles } = usePolling(api.getTles, 60 * 60 * 1000)     // SatDump refreshes them daily
  const drapeKey = drapes.map(d => d.id).join('|')

  useEffect(() => {
    let alive = true
    loadCesium().then(C => {
      if (!alive || !box.current) return
      viewer.current = createViewer(C, box.current)
      setCesium(C)
    }, e => { if (alive) setFailed(e instanceof Error ? e.message : String(e)) })
    return () => {
      alive = false
      viewer.current?.destroy()         // and the images on it
      viewer.current = null
      placed.current.clear()
      loading.current.clear()
      aimed.current = false
    }
  }, [])

  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v || !tles) return
    if (!aimed.current) {         // start above the station, far enough out to see the whole hemisphere
      v.camera.setView({ destination: cesium.Cartesian3.fromDegrees(tles.station.lon, tles.station.lat, startHeight) })
      aimed.current = true
    }
    showSatellites(cesium, v, tles, satellites, highlight)
    return () => { if (!v.isDestroyed()) v.entities.removeAll() }
  }, [cesium, tles, satellites, highlight])

  // only the images that changed come and go, so the others don't flicker. Each picture is downloaded and
  // decoded before its strip goes on the globe, so the strip never shows Cesium's white placeholder.
  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v) return
    wanted.current = new Set(drapes.map(d => d.id))
    for (const [id, image] of placed.current) {
      if (!wanted.current.has(id)) {
        v.scene.primitives.remove(image.primitive)
        placed.current.delete(id)
      }
    }
    drapes.forEach((d, i) => {
      if (placed.current.has(d.id) || loading.current.has(d.id)) return
      loading.current.add(d.id)
      const picture = new Image()
      picture.src = d.url
      picture.decode().then(() => {
        loading.current.delete(d.id)
        const now = viewer.current
        if (!now || now.isDestroyed() || !wanted.current.has(d.id)) return
        const image = passImage(cesium, d.geo, picture, IMAGE_HEIGHT + i * IMAGE_STEP)     // later ones on top
        if (!image) return
        now.scene.primitives.add(image.primitive)
        placed.current.set(d.id, image)
        setPlacedCount(n => n + 1)
      }, () => { loading.current.delete(d.id) })
    })
  }, [cesium, drapeKey])

  useEffect(() => {
    const v = viewer.current
    const image = focus && placed.current.get(focus.id)
    if (!cesium || !v || !image) return
    // straight down, north up, the whole image in view (range 0: Cesium fits the sphere)
    v.camera.flyToBoundingSphere(image.sphere, {
      duration: focus.instant ? 0 : 1.2, offset: new cesium.HeadingPitchRange(0, -Math.PI / 2, 0) })
    aimed.current = true        // the start view over the station must not replace this one
  }, [cesium, placedCount, focus?.id, focus?.at])

  return (
    <div className={size ? `globe ${size}` : 'globe'}>
      <div ref={box} className="globe-canvas" />
      {!cesium && <p className="globe-wait hint">{failed ? t('globe.failed', { error: failed }) : t('globe.loading')}</p>}
      {tles && tles.missing.length > 0 && satellites && (
        <p className="globe-note hint">{t('globe.missing', { list: tles.missing.join(', ') })}</p>
      )}
      {note && cesium && <p className="globe-note right hint">{note}</p>}
    </div>
  )
}
