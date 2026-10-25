// What stations call, with "Authorization: Bearer <token>" (protocol 1, docs/SYNC_PLAN.md):
//   GET    /ingest/hello                                   which station this token is (the Test button)
//   PUT    /ingest/passes/<pass>/files/thumb/<image>.jpg   a thumbnail (480 px JPEG), body = the file
//   PUT    /ingest/passes/<pass>/files/large/<image>.jpg   the image to show (1600 px or full-size JPEG)
//   POST   /ingest/passes/<pass>                           {pass: pass.json, images: [image paths]}: the pass
//                                                          shows once its files are all there; answers its
//                                                          id and link on the hub
//   DELETE /ingest/passes/<pass>                           remove it
// <pass> is the folder name on the station, <image> the image's path in that folder. Every call can be
// repeated: a pass sent again replaces the one before.

import type { Env } from './env'
import { deletePrefix, fileKey, passPrefix, type Kind } from './files'
import { HttpError, isObject, json, match, now, num, readJson, sha256 } from './http'
import { imagePath, passId, passName } from './names'

const PROTOCOL = 1
const MAX_FILE = 25 * 1024 * 1024
const MAX_IMAGES = 50
const LOCAL_KEYS = ['discord', 'hub', 'hubs']     // the station's own notes, not shown here

interface Station { id: string; name: string }

async function stationFromToken(request: Request, env: Env): Promise<Station> {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'send the station token: Authorization: Bearer <token>')
  const station = await env.DB.prepare('SELECT id, name FROM stations WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(token)).first<Station>()
  if (!station) throw new HttpError(401, 'unknown or revoked token: make a new one on the hub\'s Stations page')
  return station
}

async function putFile(request: Request, env: Env, station: Station, pass: string, kind: Kind, path: string) {
  const length = Number(request.headers.get('Content-Length'))
  if (!length || !request.body) throw new HttpError(411, 'send the file with its Content-Length')
  if (length > MAX_FILE) throw new HttpError(413, `files up to ${MAX_FILE / 1024 / 1024} MB`)
  await env.FILES.put(fileKey(station.id, pass, kind, path), request.body, {
    httpMetadata: { contentType: 'image/jpeg' },
  })
  return json({ stored: `${kind}/${path}.jpg` })
}

async function commit(request: Request, env: Env, station: Station, pass: string): Promise<Response> {
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
  const keys = paths.flatMap(p => [fileKey(station.id, pass, 'thumb', p), fileKey(station.id, pass, 'large', p)])
  const found = await Promise.all(keys.map(k => env.FILES.head(k)))
  const prefix = passPrefix(station.id, pass)
  const missing = keys.filter((_, i) => !found[i]).map(k => k.slice(prefix.length))
  if (missing.length) throw new HttpError(400, `send these files first: ${missing.join(', ')}`)

  // images sent last time and not now
  const before = await env.DB.prepare('SELECT path FROM images WHERE station = ? AND pass = ?')
    .bind(station.id, pass).all<{ path: string }>()
  const dropped = before.results.map(r => r.path).filter(p => !paths.includes(p))
  if (dropped.length) {
    await env.FILES.delete(dropped.flatMap(p => [fileKey(station.id, pass, 'thumb', p), fileKey(station.id, pass, 'large', p)]))
  }

  const described = new Map<string, Record<string, unknown>>()
  for (const i of Array.isArray(meta.images) ? meta.images : []) {
    if (isObject(i) && typeof i.path === 'string') described.set(i.path, i)
  }
  const main = typeof meta.main === 'string' && paths.includes(meta.main) ? meta.main : paths[0] ?? null
  const orbit = isObject(meta.orbit) ? meta.orbit : {}
  const signal = isObject(meta.signal) ? meta.signal : {}
  const stored = { ...meta }
  for (const key of LOCAL_KEYS) delete stored[key]
  const t = now()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO passes (station, id, time, satellite, main, coverage, max_el, peak_snr, meta, uploaded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (station, id) DO UPDATE SET time = excluded.time, satellite = excluded.satellite,
         main = excluded.main, coverage = excluded.coverage, max_el = excluded.max_el,
         peak_snr = excluded.peak_snr, meta = excluded.meta, uploaded_at = excluded.uploaded_at`,
    ).bind(station.id, pass, time, meta.satellite, main, num(meta.coverage), num(orbit.max_el),
      num(signal.peak_snr), JSON.stringify(stored), t),
    env.DB.prepare('DELETE FROM images WHERE station = ? AND pass = ?').bind(station.id, pass),
    ...paths.map(p => {
      const d = described.get(p) ?? {}
      return env.DB.prepare(
        'INSERT INTO images (station, pass, path, name, variants, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(station.id, pass, p, typeof d.name === 'string' ? d.name : null,
        JSON.stringify(Array.isArray(d.variants) ? d.variants : []), num(d.width), num(d.height))
    }),
    env.DB.prepare('UPDATE stations SET last_seen = ? WHERE id = ?').bind(t, station.id),
  ])

  const id = passId(station.id, pass)
  return json({ id, url: new URL(`/passes/${encodeURIComponent(id)}`, request.url).toString() })
}

async function remove(env: Env, station: Station, pass: string): Promise<Response> {
  await deletePrefix(env.FILES, passPrefix(station.id, pass))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE station = ? AND pass = ?').bind(station.id, pass),
    env.DB.prepare('DELETE FROM passes WHERE station = ? AND id = ?').bind(station.id, pass),
  ])
  return json({ deleted: passId(station.id, pass) })
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (!path.startsWith('/ingest/')) return null
  const station = await stationFromToken(request, env)

  if (path === '/ingest/hello' && method === 'GET') {
    await env.DB.prepare('UPDATE stations SET last_seen = ? WHERE id = ?').bind(now(), station.id).run()
    return json({ station, protocol: PROTOCOL })
  }
  let m = match(path, /^\/ingest\/passes\/([^/]+)\/files\/(thumb|large)\/(.+)\.jpg$/)
  if (m && method === 'PUT') return putFile(request, env, station, passName(m[0]), m[1] as Kind, imagePath(m[2]))
  m = match(path, /^\/ingest\/passes\/([^/]+)$/)
  if (m && method === 'POST') return commit(request, env, station, passName(m[0]))
  if (m && method === 'DELETE') return remove(env, station, passName(m[0]))
  return null
}
