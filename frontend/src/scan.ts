// What a Meteor's MSU-MR sees at a moment: one scan line across its track. Not a cone but a fan: the
// scanner sweeps half the scan angle to each side of nadir, and the picture is built line by line as the
// satellite moves. Modelled as SatDump 1.2.2 does for georeferencing ("normal_single_line", the same as
// backend/app/georef.py): rays from the satellite, rolled across the track and pitched, onto the WGS84
// ellipsoid, worked out in the inertial frame and turned into the Earth-fixed one at the end.

import { eciToEcf, gstime, propagate, type SatRec } from 'satellite.js'

/** SatDump 1.2.2's projection settings for MSU-MR, as written into each pass's product.cbor */
export const MSU_MR = { scanAngle: 110.1, roll: -0.31, pitch: -3.1, yaw: 0.75 }

export type Vec = [number, number, number]

const A = 6378.137                  // WGS84 semi-major axis, km
const F = 1 / 298.257223563
const B = A * (1 - F)
const E2 = F * (2 - F)
const DEG = Math.PI / 180

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** `a` turned about `axis` by `theta` radians (SatDump's rotate_vector_a_around_b) */
function rotate(a: Vec, axis: Vec, theta: number): Vec {
  const parallel = scale(axis, dot(a, axis) / dot(axis, axis))
  const ortho = sub(a, parallel)
  const w = cross(axis, ortho)
  const nOrtho = Math.sqrt(dot(ortho, ortho)), nW = Math.sqrt(dot(w, w))
  if (nOrtho === 0 || nW === 0) return a
  return add(add(scale(ortho, Math.cos(theta)), scale(w, Math.sin(theta) * nOrtho / nW)), parallel)
}

function geodetic([x, y, z]: Vec): [number, number] {
  const r = Math.hypot(x, y)
  let lat = Math.atan2(z, r * (1 - E2))
  for (let i = 0; i < 5; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
    lat = Math.atan2(z + E2 * n * Math.sin(lat), r)
  }
  return [lat, Math.atan2(y, x)]
}

function surface(lat: number, lon: number): Vec {
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - E2) * Math.sin(lat)]
}

/** where a ray first meets the WGS84 ellipsoid (SatDump's formula) */
function hitEllipsoid([x, y, z]: Vec, [u, v, w]: Vec): Vec | null {
  const a2 = A * A, c2 = B * B
  const value = -a2 * a2 * w * z - a2 * c2 * v * y - a2 * c2 * u * x
  const radical = a2 * a2 * w * w + a2 * c2 * v * v - a2 * v * v * z * z + 2 * a2 * v * w * y * z - a2 * w * w * y * y
    + a2 * c2 * u * u - a2 * u * u * z * z + 2 * a2 * u * w * x * z - a2 * w * w * x * x
    - c2 * u * u * y * y + 2 * c2 * u * v * x * y - c2 * v * v * x * x
  const magnitude = a2 * a2 * w * w + a2 * c2 * v * v + a2 * c2 * u * u
  if (radical < 0 || magnitude === 0) return null
  const d = (value - A * A * B * Math.sqrt(radical)) / magnitude
  return d < 0 ? null : [x + d * u, y + d * v, z + d * w]
}

/** The satellite and its scan line on the ground at `date`, Earth-fixed, in metres: `samples` points
    from one edge of the swath to the other. */
export function scanLine(rec: SatRec, date: Date, samples = 21): { sat: Vec; ground: Vec[] } | null {
  const pv = propagate(rec, date)
  if (!pv) return null
  const position: Vec = [pv.position.x, pv.position.y, pv.position.z]
  const velocity: Vec = [pv.velocity.x, pv.velocity.y, pv.velocity.z]
  const gmst = gstime(date)
  const fixed = (q: Vec): Vec => {
    const e = eciToEcf({ x: q[0], y: q[1], z: q[2] }, gmst)
    return [e.x * 1000, e.y * 1000, e.z * 1000]
  }
  // the ellipsoid is symmetric about the pole, so the geometry works in the inertial frame directly
  const nadir = sub(surface(...geodetic(position)), position)
  const heading = rotate(velocity, nadir, MSU_MR.yaw * DEG)
  const across = rotate(heading, nadir, 90 * DEG)
  const ground: Vec[] = []
  for (let k = 0; k < samples; k++) {
    const roll = -((k / (samples - 1) - 0.5) * MSU_MR.scanAngle) + MSU_MR.roll - 0.06
    const ray = rotate(rotate(nadir, heading, roll * DEG), across, MSU_MR.pitch * DEG)
    const hit = hitEllipsoid(position, ray)
    if (hit) ground.push(fixed(hit))
  }
  return { sat: fixed(position), ground }
}
