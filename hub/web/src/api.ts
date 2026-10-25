// Types mirror the Worker's answers (hub/src); keep the two in step.
// A receiver is a Pi (it has the token); a station is one of its places (the Pi's Settings → Stations).

import type { DrapeGeo } from '../../../frontend/src/cesium'

export type Role = 'admin' | 'viewer' | 'pending'
export interface Me { sub: string; email: string; name: string | null; picture: string | null; role: Role }

export interface ReceiverName { id: string; name: string }
export interface StationName { receiver: string; id: string; name: string; lat: number | null; lon: number | null }
/** a pass in the gallery; id is "<receiver>~<pass>", pass its folder name on the Pi */
export interface PassCard {
  id: string; receiver: string; receiver_name: string; pass: string
  station_id: string | null; station_name: string | null      // where it was received, as it was then
  time: number; satellite: string; main: string | null
  coverage: number | null; max_el: number | null; peak_snr: number | null; images: number
  drape: string | null              // the image the globe places (it has geo.json); null: can't be placed
  signal: boolean                   // it has a signal chart (signal.json)
}
/** where a pass's image lies (geo.json, from the Pi's georef.py) */
export interface PassGeo extends DrapeGeo { image: string }
/** the Pi's signal thinned for a chart (signal.json); track is [az, el] spread evenly from start to end */
export interface SignalThumb {
  start: number; end: number; track: [number, number][] | null
  samples: { t: number; el?: number; snr?: number; deframer_lock?: boolean }[]
}
export interface PassList { passes: PassCard[]; more: boolean; receivers: ReceiverName[]; stations: StationName[] }

export interface HubImage { path: string; name: string | null; variants: string[]; width: number | null; height: number | null }
/** the pass.json the Pi sent, the parts the pass page shows */
export interface PassMeta {
  coverage?: number | null
  orbit?: { max_el: number; aos: number; los: number; aos_az: number; los_az: number } | null
  signal?: { peak_snr: number; mean_snr: number; locked: number | null } | null
}
export interface PassDetail {
  id: string; receiver: ReceiverName; pass: string
  station: { id: string; name: string | null; lat: number | null; lon: number | null } | null
  time: number; satellite: string; main: string | null; uploaded_at: number; meta: PassMeta; images: HubImage[]
  drape: string | null; signal: boolean
}

export interface Receiver {
  id: string; name: string; created_at: number; revoked_at: number | null; last_seen: number | null
  passes: number; last_pass: number | null
  stations: { id: string; name: string; last_pass: number | null }[]     // the places it has sent passes from
}
/** what the Pi's settings need; the token is only ever in this answer */
export interface ReceiverLink { id: string; name: string; url: string; token: string }
export interface User { sub: string; email: string; name: string | null; role: Role; created_at: number; last_login: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.ok) return res.json() as Promise<T>
  let message = `${method} ${path} failed (${res.status})`
  try {
    const data = await res.json()
    if (data?.error) message = String(data.error)
  } catch { /* not JSON */ }
  throw new ApiError(res.status, message)
}

const enc = encodeURIComponent

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  signOut: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  passes: (q: { before?: number; receiver?: string; station?: string }) => {
    const s = new URLSearchParams()
    if (q.before) s.set('before', String(q.before))
    if (q.receiver) s.set('receiver', q.receiver)
    if (q.station) s.set('station', q.station)
    return request<PassList>('GET', `/api/passes?${s}`)
  },
  pass: (id: string) => request<PassDetail>('GET', `/api/passes/${enc(id)}`),
  geo: (id: string) => request<PassGeo>('GET', `/api/passes/${enc(id)}/geo`),
  signal: (id: string) => request<SignalThumb>('GET', `/api/passes/${enc(id)}/signal`),
  deletePass: (id: string) => request<{ deleted: string }>('DELETE', `/api/passes/${enc(id)}`),
  receivers: () => request<Receiver[]>('GET', '/api/receivers'),
  addReceiver: (name: string) => request<ReceiverLink>('POST', '/api/receivers', { name }),
  renameReceiver: (id: string, name: string) => request<ReceiverName>('PATCH', `/api/receivers/${enc(id)}`, { name }),
  newToken: (id: string) => request<ReceiverLink>('POST', `/api/receivers/${enc(id)}/token`),
  revokeReceiver: (id: string) => request<{ revoked: string }>('POST', `/api/receivers/${enc(id)}/revoke`),
  deleteReceiver: (id: string) => request<{ done: boolean }>('DELETE', `/api/receivers/${enc(id)}`),
  users: () => request<User[]>('GET', '/api/users'),
  setRole: (sub: string, role: Role) => request<{ sub: string; role: Role }>('PATCH', `/api/users/${enc(sub)}`, { role }),
  removeUser: (sub: string) => request<{ removed: string }>('DELETE', `/api/users/${enc(sub)}`),
}

/** An image of a pass: thumb (480 px) or large (what the Pi sent to show) */
export const fileUrl = (receiver: string, pass: string, kind: 'thumb' | 'large', path: string) =>
  `/api/files/${enc(receiver)}/${enc(pass)}/${kind}/${path.split('/').map(enc).join('/')}.jpg`

/** "MCIR corrected" */
export const imageLabel = (image: HubImage) =>
  [image.name ?? image.path.split('/').pop() ?? image.path, ...image.variants].join(' ')
