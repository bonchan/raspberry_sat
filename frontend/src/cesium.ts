// CesiumJS basics shared by the globe on the Pi (Globe.tsx) and the one on the hub (hub/web/src/Globe.tsx):
// loading Cesium, a viewer with the offline Natural Earth II imagery, and a pass's image draped where it was
// taken. No React and no app code here, only Cesium's types, so the hub can import it as it is.
// CesiumJS is not bundled: its prebuilt script is loaded from /cesium (see vite.config.ts) the first time a
// globe opens, so the other pages don't carry it.

import type { BoundingSphere, Primitive, Viewer } from 'cesium'

export type CesiumNS = typeof import('cesium')

declare global {
  interface Window { Cesium?: CesiumNS; CESIUM_BASE_URL?: string }
}

const BASE = '/cesium/'

/** Where a pass's image lies: lat/lon for a grid of its pixels (rows x cols, row by row; null: no data),
    as backend/app/georef.py works it out. */
export interface DrapeGeo {
  width: number; height: number; rows: number[]; cols: number[]; points: ([number, number] | null)[]
}

let loading: Promise<CesiumNS> | null = null

export function loadCesium(): Promise<CesiumNS> {
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

export function createViewer(C: CesiumNS, el: HTMLElement): Viewer {
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

/** The pass's image stretched over its grid of positions: each grid cell is two triangles whose corners
    carry the matching spot of the image, so it follows the strip's curve. Cells touching a line without
    a position (no data) are left out. */
export function passImage(C: CesiumNS, geo: DrapeGeo, picture: HTMLImageElement, altitude: number): { primitive: Primitive; sphere: BoundingSphere } | null {
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
