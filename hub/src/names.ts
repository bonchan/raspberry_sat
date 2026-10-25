// Names that end up in URLs and R2 keys, checked so none can reach outside its place.

import { HttpError } from './http'

/** "roof", "casa-2" */
export const STATION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

/** A pass's folder name on its station: "2026-10-12_1310Z_meteor-m2-3". No "~" (it joins station and pass
    in the hub's pass ids) and no "/". */
const PASS_ID = /^[A-Za-z0-9][A-Za-z0-9._ ()+-]{0,119}$/

export function passName(value: string): string {
  if (!PASS_ID.test(value)) throw new HttpError(400, `not a pass folder name: "${value}"`)
  return value
}

/** The hub's id of a pass: "<station>~<folder name>". */
export function splitPassId(id: string): { station: string; pass: string } {
  const at = id.indexOf('~')
  const station = id.slice(0, at), pass = id.slice(at + 1)
  if (at < 1 || !STATION_ID.test(station) || !PASS_ID.test(pass)) throw new HttpError(404, 'no such pass')
  return { station, pass }
}

export const passId = (station: string, pass: string) => `${station}~${pass}`

/** An image's path inside its pass folder, as SatDump wrote it: "MSU-MR/msu_mr_rgb_MCIR_corrected.png". */
export function imagePath(value: unknown): string {
  const parts = typeof value === 'string' && value.length <= 300 ? value.split('/') : []
  const ok = parts.length > 0 && parts.every(p => p !== '' && p !== '.' && p !== '..' && !/[\\\x00-\x1f\x7f]/.test(p))
  if (!ok) throw new HttpError(400, `not an image path: ${JSON.stringify(value)}`)
  return value as string
}
