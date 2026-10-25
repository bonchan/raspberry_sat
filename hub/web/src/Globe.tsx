// A CesiumJS globe with passes' images draped where they were taken and the receivers' stations as dots.
// Loading Cesium, the viewer and draping an image are shared with the station app (frontend/src/cesium.ts);
// Cesium itself is served from /cesium (vite.config.ts). Only types are imported from 'cesium' here.

import { useEffect, useRef, useState } from 'react'
import type { BoundingSphere, Primitive, Viewer } from 'cesium'
import { createViewer, loadCesium, passImage, type CesiumNS } from '../../../frontend/src/cesium'
import type { PassGeo } from './api'

const IMAGE_HEIGHT = 5000       // metres above the ground for a draped image: clear of the globe's surface
const IMAGE_STEP = 1000         // each further image a little higher, so overlapping ones don't flicker
const START_HEIGHT = 15_000_000 // metres: the whole hemisphere in view
const STATION = '#3ecf8e'

/** An image to drape: a pass's picture and where its pixels lie. */
export interface Drape { id: string; geo: PassGeo; url: string }
/** A place to mark: one of the receivers' stations */
export interface Place { key: string; name: string; lat: number; lon: number }

export default function Globe({ drapes, focus, places }: {
  drapes: Drape[]
  focus?: { id: string; at: number; instant?: boolean }   // fly to this drape; `at` changes when asked again
  places: Place[]
}) {
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const placed = useRef(new Map<string, { primitive: Primitive; sphere: BoundingSphere }>())    // by drape id
  const wanted = useRef(new Set<string>())        // the drapes asked for now, also while their pictures load
  const loading = useRef(new Set<string>())
  const aimed = useRef(false)
  const [placedCount, setPlacedCount] = useState(0)     // bumps when a picture arrives, to fly to it
  const [cesium, setCesium] = useState<CesiumNS | null>(null)
  const [failed, setFailed] = useState('')
  const drapeKey = drapes.map(d => d.id).join('|')
  const placeKey = places.map(p => `${p.key}:${p.lat},${p.lon}`).join('|')

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

  // the stations: a green dot and the name; at first the camera over the first of them
  useEffect(() => {
    const v = viewer.current
    if (!cesium || !v) return
    for (const p of places) {
      v.entities.add({
        position: cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: { pixelSize: 8, color: cesium.Color.fromCssColorString(STATION), outlineColor: cesium.Color.BLACK,
                 outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: p.name, font: '13px sans-serif', fillColor: cesium.Color.WHITE, outlineColor: cesium.Color.BLACK,
          outlineWidth: 3, style: cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new cesium.Cartesian2(0, -10), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
    if (!aimed.current && places.length) {
      v.camera.setView({ destination: cesium.Cartesian3.fromDegrees(places[0].lon, places[0].lat, START_HEIGHT) })
    }
    return () => { if (!v.isDestroyed()) v.entities.removeAll() }
  }, [cesium, placeKey])

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
    aimed.current = true
  }, [cesium, placedCount, focus?.id, focus?.at])

  return (
    <div className="globe">
      <div ref={box} className="globe-canvas" />
      {!cesium && <p className="globe-wait hint">{failed ? `The globe could not load: ${failed}` : 'Loading the globe…'}</p>}
    </div>
  )
}
