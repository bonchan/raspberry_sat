// Types mirror the Worker's answers (hub/src); keep the two in step.

export type Role = 'admin' | 'viewer' | 'pending'
export interface Me { sub: string; email: string; name: string | null; picture: string | null; role: Role }

export interface StationName { id: string; name: string }
/** a pass in the gallery; id is "<station>~<pass>", pass its folder name on the station */
export interface PassCard {
  id: string; station: string; pass: string; station_name: string; time: number; satellite: string
  main: string | null; coverage: number | null; max_el: number | null; peak_snr: number | null; images: number
}
export interface PassList { passes: PassCard[]; more: boolean; stations: StationName[] }

export interface HubImage { path: string; name: string | null; variants: string[]; width: number | null; height: number | null }
/** the pass.json the station sent, the parts the pass page shows */
export interface PassMeta {
  coverage?: number | null
  station?: { name: string; lat: number; lon: number; alt: number }
  orbit?: { max_el: number; aos: number; los: number; aos_az: number; los_az: number } | null
  signal?: { peak_snr: number; mean_snr: number; locked: number | null } | null
}
export interface PassDetail {
  id: string; station: StationName; pass: string; time: number; satellite: string; main: string | null
  uploaded_at: number; meta: PassMeta; images: HubImage[]
}

export interface Station {
  id: string; name: string; created_at: number; revoked_at: number | null; last_seen: number | null
  passes: number; last_pass: number | null
}
/** what a station's settings need; the token is only ever in this answer */
export interface StationLink { id: string; name: string; url: string; token: string }
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
  passes: (q: { before?: number; station?: string }) => {
    const s = new URLSearchParams()
    if (q.before) s.set('before', String(q.before))
    if (q.station) s.set('station', q.station)
    return request<PassList>('GET', `/api/passes?${s}`)
  },
  pass: (id: string) => request<PassDetail>('GET', `/api/passes/${enc(id)}`),
  deletePass: (id: string) => request<{ deleted: string }>('DELETE', `/api/passes/${enc(id)}`),
  stations: () => request<Station[]>('GET', '/api/stations'),
  addStation: (id: string, name: string) => request<StationLink>('POST', '/api/stations', { id, name }),
  newToken: (id: string) => request<StationLink>('POST', `/api/stations/${enc(id)}/token`),
  revokeStation: (id: string) => request<{ revoked: string }>('POST', `/api/stations/${enc(id)}/revoke`),
  deleteStation: (id: string) => request<{ done: boolean }>('DELETE', `/api/stations/${enc(id)}`),
  users: () => request<User[]>('GET', '/api/users'),
  setRole: (sub: string, role: Role) => request<{ sub: string; role: Role }>('PATCH', `/api/users/${enc(sub)}`, { role }),
  removeUser: (sub: string) => request<{ removed: string }>('DELETE', `/api/users/${enc(sub)}`),
}

/** An image of a pass: thumb (480 px) or large (what the station sent to show) */
export const fileUrl = (station: string, pass: string, kind: 'thumb' | 'large', path: string) =>
  `/api/files/${enc(station)}/${enc(pass)}/${kind}/${path.split('/').map(enc).join('/')}.jpg`

/** "MCIR corrected" */
export const imageLabel = (image: HubImage) =>
  [image.name ?? image.path.split('/').pop() ?? image.path, ...image.variants].join(' ')
