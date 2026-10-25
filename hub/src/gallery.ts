// The gallery, for viewers and admins: passes newest first, one pass with its images, the image files.

import { requireUser } from './auth'
import type { Env } from './env'
import { deletePrefix, fileKey, passPrefix, type Kind } from './files'
import { HttpError, json, match } from './http'
import { RECEIVER_ID, imagePath, passId, passName, splitPassId } from './names'

const PAGE = 60

interface PassRow {
  receiver: string; id: string; time: number; satellite: string; main: string | null
  coverage: number | null; max_el: number | null; peak_snr: number | null
  station_id: string | null; station_name: string | null; receiver_name: string; images: number
}

/** A page of passes, newest first: `before` (a pass's time) for the next page; `receiver`, and `station`
    (one of the receiver's places), to show only those. With the receivers and stations for the filters. */
async function list(env: Env, url: URL): Promise<Response> {
  const before = Number(url.searchParams.get('before')) || null
  const receiver = url.searchParams.get('receiver') || null
  const station = url.searchParams.get('station') || null
  if (receiver !== null && !RECEIVER_ID.test(receiver)) throw new HttpError(400, 'no such receiver')
  const { results } = await env.DB.prepare(
    `SELECT p.receiver, p.id, p.time, p.satellite, p.main, p.coverage, p.max_el, p.peak_snr,
       p.station_id, p.station_name, r.name AS receiver_name,
       (SELECT COUNT(*) FROM images i WHERE i.receiver = p.receiver AND i.pass = p.id) AS images
     FROM passes p JOIN receivers r ON r.id = p.receiver
     WHERE (?1 IS NULL OR p.time < ?1) AND (?2 IS NULL OR p.receiver = ?2) AND (?3 IS NULL OR p.station_id = ?3)
     ORDER BY p.time DESC LIMIT ?4`,
  ).bind(before, receiver, station, PAGE + 1).all<PassRow>()
  const receivers = await env.DB.prepare('SELECT id, name FROM receivers ORDER BY name').all<{ id: string; name: string }>()
  const stations = await env.DB.prepare('SELECT receiver, id, name FROM stations ORDER BY name')
    .all<{ receiver: string; id: string; name: string }>()
  return json({
    passes: results.slice(0, PAGE).map(r => ({ ...r, pass: r.id, id: passId(r.receiver, r.id) })),
    more: results.length > PAGE,
    receivers: receivers.results,
    stations: stations.results,
  })
}

async function detail(env: Env, id: string): Promise<Response> {
  const { receiver, pass } = splitPassId(id)
  const row = await env.DB.prepare(
    `SELECT p.time, p.satellite, p.main, p.meta, p.uploaded_at, p.station_id, p.station_name, p.lat, p.lon,
       r.name AS receiver_name
     FROM passes p JOIN receivers r ON r.id = p.receiver WHERE p.receiver = ? AND p.id = ?`,
  ).bind(receiver, pass).first<{
    time: number; satellite: string; main: string | null; meta: string; uploaded_at: number
    station_id: string | null; station_name: string | null; lat: number | null; lon: number | null; receiver_name: string
  }>()
  if (!row) throw new HttpError(404, 'no such pass')
  const { results } = await env.DB.prepare(
    'SELECT path, name, variants, width, height FROM images WHERE receiver = ? AND pass = ? ORDER BY path',
  ).bind(receiver, pass).all<{ path: string; name: string | null; variants: string; width: number | null; height: number | null }>()
  // the main image first, the others by name
  const images = results.map(i => ({ ...i, variants: JSON.parse(i.variants || '[]') as string[] }))
    .sort((a, b) => Number(b.path === row.main) - Number(a.path === row.main))
  return json({
    id, receiver: { id: receiver, name: row.receiver_name }, pass,
    station: row.station_id ? { id: row.station_id, name: row.station_name, lat: row.lat, lon: row.lon } : null,
    time: row.time, satellite: row.satellite, main: row.main, uploaded_at: row.uploaded_at,
    meta: JSON.parse(row.meta), images,
  })
}

async function file(request: Request, env: Env, receiver: string, pass: string, kind: Kind, path: string) {
  const object = await env.FILES.get(fileKey(receiver, pass, kind, path), { onlyIf: request.headers })
  if (!object) throw new HttpError(404, 'no such image')
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
    'Cache-Control': 'private, max-age=86400',
    ETag: object.httpEtag,
  })
  return 'body' in object ? new Response(object.body, { headers }) : new Response(null, { status: 304, headers })
}

async function remove(env: Env, id: string): Promise<Response> {
  const { receiver, pass } = splitPassId(id)
  await deletePrefix(env.FILES, passPrefix(receiver, pass))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE receiver = ? AND pass = ?').bind(receiver, pass),
    env.DB.prepare('DELETE FROM passes WHERE receiver = ? AND id = ?').bind(receiver, pass),
  ])
  return json({ deleted: id })
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (path === '/api/passes' && method === 'GET') {
    await requireUser(request, env, 'admin', 'viewer')
    return list(env, url)
  }
  let m = match(path, /^\/api\/passes\/([^/]+)$/)
  if (m && method === 'GET') {
    await requireUser(request, env, 'admin', 'viewer')
    return detail(env, m[0])
  }
  if (m && method === 'DELETE') {
    await requireUser(request, env, 'admin')
    return remove(env, m[0])
  }
  m = match(path, /^\/api\/files\/([^/]+)\/([^/]+)\/(thumb|large)\/(.+)\.jpg$/)
  if (m && method === 'GET') {
    await requireUser(request, env, 'admin', 'viewer')
    if (!RECEIVER_ID.test(m[0])) throw new HttpError(404, 'no such image')
    return file(request, env, m[0], passName(m[1]), m[2] as Kind, imagePath(m[3]))
  }
  return null
}
