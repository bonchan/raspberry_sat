// A CesiumJS globe with the satellites in the settings where they are now, their next orbit, the
// station, and the last pass's image draped where it was taken (/api/passes/{id}/geo, georef.py).
// Offline: the imagery is Natural Earth II, which ships with CesiumJS; no Cesium ion. Loading Cesium, the
// viewer and draping an image are in cesium.ts (the hub's globe uses them too). Only types are imported
// from 'cesium' here.

import { useEffect, useRef, useState } from 'react'
import type { BoundingSphere, Cartesian3, Primitive, Viewer } from 'cesium'
import { eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js'
import { api, passFile, type PassGeo, type PassSummary, type TleSet } from './api'
import { createViewer, loadCesium, passImage, type CesiumNS } from './cesium'
import { useT } from './i18n'
import { scanLine, type Vec } from './scan'
import { store, stored } from './storage'
import { useTopic } from './stream'

const ORBIT_STEP = 30           // seconds between points of the next-orbit line
const ORBIT_REFRESH = 60_000    // ms; the line starts at the satellite, so it is redrawn now and then
const COLORS = { station: '#3ecf8e', satellite: '#4da3ff', receiving: '#ffd23f' }
const IMAGE_HEIGHT = 5000       // metres above the ground for a draped image: clear of the globe's surface
const IMAGE_STEP = 1000         // each further image a little higher, so overlapping ones don't flicker
const ON_TOP = Number.POSITIVE_INFINITY      // labels and dots drawn over the images, never hidden by them
const BEHIND = 0.3              // opacity of a satellite on the far side of the Earth from the camera
const FOLLOW_RANGE = 3_200_000  // follow mode to start with: metres from the camera to the satellite
const FOLLOW_PITCH = -0.8       // ... looking this far down (radians, about 46°), the way it travels
const MODE = 'globe-mode'       // this browser's choice of follow or static (storage.ts)
const CONE = 'globe-cone'       // ... and whether the camera's satellite shows what it sees
const STATION_ID = 'station', SAT_ID = 'sat-'     // entity ids: a click on the globe tells what it hit

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

/** The station, and with `satellites` the enabled satellites in the settings where they are now and their next
    orbit; `order` numbers them by their next recorded pass. Whatever is behind the Earth is faded. */
function showSatellites(C: CesiumNS, viewer: Viewer, tles: TleSet, satellites: boolean, highlight?: number,
                        order?: Record<number, number>) {
  const label = (text: string) => ({
    text, font: '13px sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
    style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -12),
    disableDepthTestDistance: ON_TOP,
  })
  const occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, viewer.camera.positionWC)
  const dim = (c: InstanceType<CesiumNS['Color']>) => [c, c.withAlpha(BEHIND)]
  const [black, blackDim] = dim(C.Color.BLACK), [white, whiteDim] = dim(C.Color.WHITE)
  /** where a thing is and whether the Earth hides it from the camera, worked out once per frame */
  const follow = (where: () => Cartesian3 | undefined) => {
    let frameAt = -1, at: Cartesian3 | undefined, seen = true
    return () => {
      const ms = Date.now()
      if (ms !== frameAt) {
        frameAt = ms
        at = where()
        occluder.cameraPosition = viewer.camera.positionWC
        seen = !at || occluder.isPointVisible(at)
      }
      return { at, seen }
    }
  }
  const fadedLabel = (text: string, seen: () => boolean) => ({
    ...label(text),
    fillColor: new C.CallbackProperty(() => (seen() ? white : whiteDim), false),
    outlineColor: new C.CallbackProperty(() => (seen() ? black : blackDim), false),
  })

  const { station } = tles
  const stationAt = C.Cartesian3.fromDegrees(station.lon, station.lat, station.alt)
  const [green, greenDim] = dim(C.Color.fromCssColorString(COLORS.station))
  const home = follow(() => stationAt)
  viewer.entities.add({
    id: STATION_ID,
    position: stationAt,
    point: {
      pixelSize: 8, outlineWidth: 1, disableDepthTestDistance: ON_TOP,
      color: new C.CallbackProperty(() => (home().seen ? green : greenDim), false),
      outlineColor: new C.CallbackProperty(() => (home().seen ? black : blackDim), false),
    },
    label: fadedLabel(station.name, () => home().seen),
  })
  for (const sat of satellites ? tles.satellites.filter(s => s.enabled) : []) {
    const rec = twoline2satrec(sat.line1, sat.line2)
    const receiving = sat.norad === highlight
    const [color, colorDim] = dim(C.Color.fromCssColorString(receiving ? COLORS.receiving : COLORS.satellite))
    const now = follow(() => positionAt(C, rec, new Date()))
    const rank = order?.[sat.norad]
    let orbit: Cartesian3[] = []
    let orbitAt = 0
    viewer.entities.add({
      id: `${SAT_ID}${sat.norad}`,
      position: new C.CallbackPositionProperty(() => now().at, false),
      point: {
        pixelSize: receiving ? 12 : 9, outlineWidth: 2, disableDepthTestDistance: ON_TOP,
        color: new C.CallbackProperty(() => (now().seen ? color : colorDim), false),
        outlineColor: new C.CallbackProperty(() => (now().seen ? black : blackDim), false),
      },
      label: fadedLabel(rank ? `#${rank} ${sat.name}` : sat.name, () => now().seen),
      polyline: {
        positions: new C.CallbackProperty(() => {
          if (Date.now() - orbitAt > ORBIT_REFRESH) {
            orbit = nextOrbit(C, rec)
            orbitAt = Date.now()
          }
          return orbit
        }, false),
        width: receiving ? 2 : 1.5, arcType: C.ArcType.NONE, material: color.withAlpha(0.55),     // the Earth hides it
      },
    })
  }
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
  order?: Record<number, number>      // NORAD number -> place in the order of the next recorded passes
  cameraModes?: boolean               // follow / static buttons, and a click on the station or a satellite aims at it
}

type CameraMode = 'follow' | 'static'
type Target = { kind: 'station'; at: number } | { kind: 'sat'; norad: number; at: number }

const storedMode = (): CameraMode => (stored(MODE) === 'static' ? 'static' : 'follow')

export default function Globe({ size, satellites = false, highlight, drapes = [], focus, note, startHeight = 15_000_000,
                                order, cameraModes = false }: Props) {
  const t = useT()
  const [mode, setModeState] = useState<CameraMode>(storedMode)
  const [cone, setConeState] = useState(() => stored(CONE) === '1')
  const [target, setTarget] = useState<Target | null>(null)       // the last thing clicked on the globe
  const orderKey = JSON.stringify(order ?? {})
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const aimed = useRef(false)
  // follow mode: where the camera sits around the followed satellite, in its travelling frame, as the user left it
  const followOffset = useRef<{ norad: number; offset: Cartesian3 } | null>(null)
  const placed = useRef(new Map<string, { primitive: Primitive; sphere: BoundingSphere }>())    // by drape id
  const wanted = useRef(new Set<string>())        // the drapes asked for now, also while their pictures load
  const loading = useRef(new Set<string>())
  const [placedCount, setPlacedCount] = useState(0)     // bumps when a picture arrives, to fly to it
  const [cesium, setCesium] = useState<CesiumNS | null>(null)
  const [failed, setFailed] = useState('')
  const tles = useTopic('tles')            // pushed again when SatDump refreshes them (daily) or the settings change
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
    showSatellites(cesium, v, tles, satellites, highlight, order)
    return () => { if (!v.isDestroyed()) v.entities.removeAll() }
  }, [cesium, tles, satellites, highlight, orderKey])

  // a click on the station or a satellite (its dot, name or orbit) makes it the camera's target
  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v || !cameraModes) return
    const handler = new cesium.ScreenSpaceEventHandler(v.scene.canvas)
    handler.setInputAction((click: { position: InstanceType<CesiumNS['Cartesian2']> }) => {
      const id = v.scene.pick(click.position)?.id?.id
      if (id === STATION_ID) setTarget({ kind: 'station', at: Date.now() })
      else if (typeof id === 'string' && id.startsWith(SAT_ID)) setTarget({ kind: 'sat', norad: Number(id.slice(SAT_ID.length)), at: Date.now() })
    }, cesium.ScreenSpaceEventType.LEFT_CLICK)
    // Cesium's own double click zooms to and tracks an entity, which would fight the modes below
    v.cesiumWidget.screenSpaceEventHandler.removeInputAction(cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    return () => { handler.destroy() }
  }, [cesium, cameraModes])

  // the camera's target: what was clicked; otherwise, during a pass, the satellite being received (follow)
  // or the station (static). Follow chases a satellite from behind, the way it travels, looking down;
  // static flies over the target once, at the same height, and leaves the camera free.
  const aim: Target | null = target ?? (highlight === undefined ? null
    : mode === 'follow' ? { kind: 'sat', norad: highlight, at: 0 } : { kind: 'station', at: 0 })
  const aimKey = aim ? `${aim.kind}-${aim.kind === 'sat' ? aim.norad : ''}-${aim.at}` : ''
  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v || !tles || !cameraModes || !aim) return
    const C = cesium
    const sat = aim.kind === 'sat' ? tles.satellites.find(s => s.norad === aim.norad) : undefined
    const rec = sat && twoline2satrec(sat.line1, sat.line2)
    if (mode === 'static' || !rec) {
      const where = rec ? positionAt(C, rec, new Date()) : C.Cartesian3.fromDegrees(tles.station.lon, tles.station.lat)
      if (!where) return
      const over = C.Cartographic.fromCartesian(where)
      v.camera.flyTo({
        destination: C.Cartesian3.fromRadians(over.longitude, over.latitude, v.camera.positionCartographic.height),
        duration: 1,
      })
      return
    }
    // The camera hangs in a frame that travels with the satellite: its east/north/up turned so that "ahead"
    // is the way it flies. Each frame the camera keeps its place in that frame, so dragging and zooming
    // (which move it around the satellite) last, as long as the same satellite is followed.
    const norad = sat!.norad
    const start = followOffset.current?.norad === norad ? followOffset.current.offset : null
    let first = true
    const follow = () => {
      const ms = Date.now()
      const here = positionAt(C, rec, new Date(ms)), ahead = positionAt(C, rec, new Date(ms + 1000))
      if (!here || !ahead) return
      const enu = C.Transforms.eastNorthUpToFixedFrame(here)
      const step = C.Matrix4.multiplyByPoint(C.Matrix4.inverseTransformation(enu, new C.Matrix4()), ahead, new C.Cartesian3())
      const heading = Math.atan2(step.x, step.y)          // the way it travels, from north towards east
      const turn = C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(-heading), C.Cartesian3.ZERO)
      const frame = C.Matrix4.multiply(enu, turn, new C.Matrix4())
      if (first) {
        first = false
        if (start) v.camera.lookAtTransform(frame, start)
        else v.camera.lookAtTransform(frame, new C.HeadingPitchRange(0, FOLLOW_PITCH, FOLLOW_RANGE))
      } else {
        v.camera.lookAtTransform(frame, C.Cartesian3.clone(v.camera.position))   // same place in the new frame
      }
      followOffset.current = { norad, offset: C.Cartesian3.clone(v.camera.position) }
    }
    const stop = v.scene.preRender.addEventListener(follow)
    // Cesium doesn't tilt (middle drag) while the camera rides a frame: let middle drag orbit like left drag
    const controls = v.scene.screenSpaceCameraController
    const saved = { rotate: controls.rotateEventTypes, tilt: controls.tiltEventTypes }
    const middle = C.CameraEventType.MIDDLE_DRAG
    controls.rotateEventTypes = [C.CameraEventType.LEFT_DRAG, middle]
    controls.tiltEventTypes = Array.isArray(saved.tilt) ? saved.tilt.filter(e => e !== middle) : saved.tilt
    return () => {
      stop()
      if (v.isDestroyed()) return
      v.camera.lookAtTransform(C.Matrix4.IDENTITY)
      controls.rotateEventTypes = saved.rotate
      controls.tiltEventTypes = saved.tilt
    }
  }, [cesium, tles, aimKey, mode, cameraModes])

  // the cone: what the satellite the camera is aimed at sees right now, its MSU-MR scan line (scan.ts):
  // the rays from the satellite to the edges of the swath and a few between, and the line on the ground
  const coneNorad = cone && aim?.kind === 'sat' ? aim.norad : null
  useEffect(() => {
    const v = viewer.current
    const sat = tles?.satellites.find(s => s.norad === coneNorad)
    if (!cesium || !v || !sat) return
    const C = cesium
    const rec = twoline2satrec(sat.line1, sat.line2)
    let frameAt = -1, line: ReturnType<typeof scanLine> = null
    const now = () => {                 // once per frame
      const ms = Date.now()
      if (ms !== frameAt) {
        frameAt = ms
        line = scanLine(rec, new Date(ms))
      }
      return line
    }
    const at = (q: Vec) => new C.Cartesian3(q[0], q[1], q[2])
    const color = C.Color.fromCssColorString(COLORS.receiving)
    const source = new C.CustomDataSource('cone')       // its own, so redrawing the satellites leaves it alone
    const lines = (points: (l: NonNullable<typeof line>) => Vec[], width: number, alpha: number) => source.entities.add({
      polyline: {
        positions: new C.CallbackProperty(() => { const l = now(); return l ? points(l).map(at) : [] }, false),
        width, arcType: C.ArcType.NONE, material: color.withAlpha(alpha),
      },
    })
    lines(l => l.ground.filter((_, i) => i % 5 === 0).flatMap(g => [l.sat, g]), 1, 0.35)     // rays across the scan
    lines(l => [l.ground[0], l.sat, l.ground[l.ground.length - 1]], 2, 0.9)                  // its two edges
    lines(l => l.ground, 3, 0.9)                                                             // the line on the ground
    v.dataSources.add(source)
    return () => { if (!v.isDestroyed()) v.dataSources.remove(source, true) }
  }, [cesium, tles, coneNorad])

  function setCone(on: boolean) {
    setConeState(on)
    store(CONE, on ? '1' : '0')
  }

  function setMode(next: CameraMode) {
    setModeState(next)
    store(MODE, next)
  }

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
      {cameraModes && cesium && (
        <div className="chips globe-modes">
          {(['follow', 'static'] as const).map(m => (
            <button key={m} className={mode === m ? 'chip on' : 'chip'} onClick={() => setMode(m)}>{t(`globe.${m}`)}</button>
          ))}
          <button className={cone ? 'chip on toggle' : 'chip toggle'} aria-pressed={cone} onClick={() => setCone(!cone)}>
            {t('globe.cone')}
          </button>
        </div>
      )}
    </div>
  )
}
