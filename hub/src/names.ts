// Names that end up in URLs and R2 keys, checked so none can reach outside its place.

import { HttpError } from './http'

/** A receiver's id, made by the hub (newReceiverId). */
export const RECEIVER_ID = /^[a-z0-9]{4,32}$/

// no 0/o, 1/l: easier to read aloud
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** "k7m2q9xd": 8 random characters (40 bits). */
export function newReceiverId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map(b => ALPHABET[b % ALPHABET.length]).join('')
}

/** A pass's folder name on its receiver: "2026-10-12_1310Z_meteor-m2-3". No "~" (it joins receiver and pass
    in the hub's pass ids) and no "/". */
const PASS_ID = /^[A-Za-z0-9][A-Za-z0-9._ ()+-]{0,119}$/

export function passName(value: string): string {
  if (!PASS_ID.test(value)) throw new HttpError(400, `not a pass folder name: "${value}"`)
  return value
}

/** The hub's id of a pass: "<receiver>~<folder name>". */
export function splitPassId(id: string): { receiver: string; pass: string } {
  const at = id.indexOf('~')
  const receiver = id.slice(0, at), pass = id.slice(at + 1)
  if (at < 1 || !RECEIVER_ID.test(receiver) || !PASS_ID.test(pass)) throw new HttpError(404, 'no such pass')
  return { receiver, pass }
}

export const passId = (receiver: string, pass: string) => `${receiver}~${pass}`

/** An image's path inside its pass folder, as SatDump wrote it: "MSU-MR/msu_mr_rgb_MCIR_corrected.png". */
export function imagePath(value: unknown): string {
  const parts = typeof value === 'string' && value.length <= 300 ? value.split('/') : []
  const ok = parts.length > 0 && parts.every(p => p !== '' && p !== '.' && p !== '..' && !/[\\\x00-\x1f\x7f]/.test(p))
  if (!ok) throw new HttpError(400, `not an image path: ${JSON.stringify(value)}`)
  return value as string
}
