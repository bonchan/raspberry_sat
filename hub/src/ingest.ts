// What receivers (Pis) call, with "Authorization: Bearer <token>" (protocol 1, docs/SYNC_PLAN.md):
//   GET    /ingest/hello                                   which receiver this token is (the Test button)
//   PUT    /ingest/passes/<pass>/files/thumb/<image>.jpg   a thumbnail (480 px JPEG), body = the file
//   PUT    /ingest/passes/<pass>/files/large/<image>.jpg   the image to show (1600 px or full-size JPEG)
//   POST   /ingest/passes/<pass>                           {pass: pass.json, images: [image paths]}: the pass
//                                                          shows once its files are all there; answers its
//                                                          id, link and the receiver's id
//   DELETE /ingest/passes/<pass>                           remove it
// <pass> is the folder name on the Pi, <image> the image's path in that folder. pass.json's "station" says
// which of the Pi's stations (places) received it: {id, name, lat, lon, alt}. Every call can be repeated:
// a pass sent again replaces the one before.

import type { Env } from './env'
import { deletePrefix, fileKey, passPrefix, type Kind } from './files'
import { HttpError, isObject, json, match, now, num, readJson, sha256 } from './http'
import { imagePath, passId, passName } from './names'

const PROTOCOL = 1
const MAX_FILE = 25 * 1024 * 1024
const MAX_IMAGES = 50
const LOCAL_KEYS = ['discord', 'hub', 'hubs', 'slimmed']     // the Pi's own notes, not shown here

interface Receiver { id: string; name: string }

async function receiverFromToken(request: Request, env: Env): Promise<Receiver> {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'send the receiver\'s token: Authorization: Bearer <token>')
  const receiver = await env.DB.prepare('SELECT id, name FROM receivers WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(token)).first<Receiver>()
  if (!receiver) throw new HttpError(401, 'unknown or revoked token: make a new one on the hub\'s Receivers page')
  return receiver
}

async function putFile(request: Request, env: Env, receiver: Receiver, pass: string, kind: Kind, path: string) {
  const length = Number(request.headers.get('Content-Length'))
  if (!length || !request.body) throw new HttpError(411, 'send the file with its Content-Length')
  if (length > MAX_FILE) throw new HttpError(413, `files up to ${MAX_FILE / 1024 / 1024} MB`)
  await env.FILES.put(fileKey(receiver.id, pass, kind, path), request.body, {
    httpMetadata: { contentType: 'image/jpeg' },
  })
  return json({ stored: `${kind}/${path}.jpg` })
}

/** The Pi's station (place) the pass was received at, from pass.json, or null. */
function stationOf(meta: Record<string, unknown>) {
  const s = isObject(meta.station) ? meta.station : null
  const id = s && typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : null
  if (!s || !id) return null
  const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : id
  return { id, name, lat: num(s.lat), lon: num(s.lon), alt: num(s.alt) }
}

async function commit(request: Request, env: Env, receiver: Receiver, pass: string): Promise<Response> {
  const body = await readJson<{ pass?: unknown; images?: unknown }>(request)
  const meta = body.pass
  if (!isObject(meta)) throw new HttpError(400, '"pass" must be the pass.json object')
  const time = num(meta.time)
  if (time === null || time <= 0) throw new HttpError(400, 'pass.time must be a unix time')
  if (typeof meta.satellite !== 'string' || !meta.satellite) throw new HttpError(400, 'pass.satellite is missing')
  if (!Array.isArray(body.images)) throw new HttpError(400, '"images" must list the paths of the images sent')
  const paths = [...new Set(body.images.map(imagePath))]
  if (paths.length > MAX_IMAGES) throw new HttpError(400, `at most ${MAX_IMAGES} images`)

  // every image needs both of its files, so the gallery never shows a broken one
  const keys = paths.flatMap(p => [fileKey(receiver.id, pass, 'thumb', p), fileKey(receiver.id, pass, 'large', p)])
  const found = await Promise.all(keys.map(k => env.FILES.head(k)))
  const prefix = passPrefix(receiver.id, pass)
  const missing = keys.filter((_, i) => !found[i]).map(k => k.slice(prefix.length))
  if (missing.length) throw new HttpError(400, `send these files first: ${missing.join(', ')}`)

  // images sent last time and not now
  const before = await env.DB.prepare('SELECT path FROM images WHERE receiver = ? AND pass = ?')
    .bind(receiver.id, pass).all<{ path: string }>()
  const dropped = before.results.map(r => r.path).filter(p => !paths.includes(p))
  if (dropped.length) {
    await env.FILES.delete(dropped.flatMap(p => [fileKey(receiver.id, pass, 'thumb', p), fileKey(receiver.id, pass, 'large', p)]))
  }

  const described = new Map<string, Record<string, unknown>>()
  for (const i of Array.isArray(meta.images) ? meta.images : []) {
    if (isObject(i) && typeof i.path === 'string') described.set(i.path, i)
  }
  const main = typeof meta.main === 'string' && paths.includes(meta.main) ? meta.main : paths[0] ?? null
  const orbit = isObject(meta.orbit) ? meta.orbit : {}
  const signal = isObject(meta.signal) ? meta.signal : {}
  const station = stationOf(meta)
  const stored = { ...meta }
  for (const key of LOCAL_KEYS) delete stored[key]
  const t = now()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO passes (receiver, id, time, satellite, station_id, station_name, lat, lon, main, coverage,
         max_el, peak_snr, meta, uploaded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT (receiver, id) DO UPDATE SET time = excluded.time, satellite = excluded.satellite,
         station_id = excluded.station_id, station_name = excluded.station_name, lat = excluded.lat,
         lon = excluded.lon, main = excluded.main, coverage = excluded.coverage, max_el = excluded.max_el,
         peak_snr = excluded.peak_snr, meta = excluded.meta, uploaded_at = excluded.uploaded_at`,
    ).bind(receiver.id, pass, time, meta.satellite, station?.id ?? null, station?.name ?? null,
      station?.lat ?? null, station?.lon ?? null, main, num(meta.coverage), num(orbit.max_el),
      num(signal.peak_snr), JSON.stringify(stored), t),
    // the station's name and position as its latest pass has them (an older pass sent again doesn't win)
    ...(station ? [env.DB.prepare(
      `INSERT INTO stations (receiver, id, name, lat, lon, alt, last_pass) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (receiver, id) DO UPDATE SET
         name = CASE WHEN excluded.last_pass >= COALESCE(stations.last_pass, 0) THEN excluded.name ELSE stations.name END,
         lat = CASE WHEN excluded.last_pass >= COALESCE(stations.last_pass, 0) THEN excluded.lat ELSE stations.lat END,
         lon = CASE WHEN excluded.last_pass >= COALESCE(stations.last_pass, 0) THEN excluded.lon ELSE stations.lon END,
         alt = CASE WHEN excluded.last_pass >= COALESCE(stations.last_pass, 0) THEN excluded.alt ELSE stations.alt END,
         last_pass = MAX(COALESCE(stations.last_pass, 0), excluded.last_pass)`,
    ).bind(receiver.id, station.id, station.name, station.lat, station.lon, station.alt, time)] : []),
    env.DB.prepare('DELETE FROM images WHERE receiver = ? AND pass = ?').bind(receiver.id, pass),
    ...paths.map(p => {
      const d = described.get(p) ?? {}
      return env.DB.prepare(
        'INSERT INTO images (receiver, pass, path, name, variants, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(receiver.id, pass, p, typeof d.name === 'string' ? d.name : null,
        JSON.stringify(Array.isArray(d.variants) ? d.variants : []), num(d.width), num(d.height))
    }),
    env.DB.prepare('UPDATE receivers SET last_seen = ? WHERE id = ?').bind(t, receiver.id),
  ])

  const id = passId(receiver.id, pass)
  return json({ id, url: new URL(`/passes/${encodeURIComponent(id)}`, request.url).toString(), receiver: receiver.id })
}

async function remove(env: Env, receiver: Receiver, pass: string): Promise<Response> {
  await deletePrefix(env.FILES, passPrefix(receiver.id, pass))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE receiver = ? AND pass = ?').bind(receiver.id, pass),
    env.DB.prepare('DELETE FROM passes WHERE receiver = ? AND id = ?').bind(receiver.id, pass),
  ])
  return json({ deleted: passId(receiver.id, pass) })
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (!path.startsWith('/ingest/')) return null
  const receiver = await receiverFromToken(request, env)

  if (path === '/ingest/hello' && method === 'GET') {
    await env.DB.prepare('UPDATE receivers SET last_seen = ? WHERE id = ?').bind(now(), receiver.id).run()
    // "station": what Pis from before the receivers read; remove once they have updated
    return json({ receiver, station: receiver, protocol: PROTOCOL })
  }
  let m = match(path, /^\/ingest\/passes\/([^/]+)\/files\/(thumb|large)\/(.+)\.jpg$/)
  if (m && method === 'PUT') return putFile(request, env, receiver, passName(m[0]), m[1] as Kind, imagePath(m[2]))
  m = match(path, /^\/ingest\/passes\/([^/]+)$/)
  if (m && method === 'POST') return commit(request, env, receiver, passName(m[0]))
  if (m && method === 'DELETE') return remove(env, receiver, passName(m[0]))
  return null
}
