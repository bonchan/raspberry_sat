// The gallery: passes newest first, one pass with its images, the image files. Admins and viewers see
// everything. Everyone else (signed out, or pending) sees what is public, which also keeps traffic down:
// one image per pass (its MCIR corrected), the facts without the sky track or the signal, the globe, and the
// stations only roughly placed. The sign-in page shows the newest pass with its sky track and signal too.

import { requireUser, seesAll } from './auth'
import type { Env } from './env'
import { dataKey, deletePrefix, fileKey, passPrefix, type DataName, type Kind } from './files'
import { HttpError, isObject, json, match, num } from './http'
import { RECEIVER_ID, imagePath, passId, passName, splitPassId } from './names'

const PAGE = 60

/** SQL: the image of pass `p` everyone may see: its MCIR corrected (as the Pi names it), else its main image.
    Also the link preview's image (preview.ts). */
export const PUBLIC_IMAGE =`COALESCE((SELECT i.path FROM images i WHERE i.receiver = p.receiver AND i.pass = p.id
  AND i.name = 'MCIR' AND i.variants = '["corrected"]' LIMIT 1), p.main)`

/** about 10 km: enough for a dot on the globe, not a street address */
const rough = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)

/** full: everything; public: what everyone sees; latest: public with the sky track and signal (sign-in page) */
type View = 'full' | 'public' | 'latest'

interface PassRow {
  receiver: string; id: string; time: number; satellite: string; main: string | null
  coverage: number | null; max_el: number | null; peak_snr: number | null
  station_id: string | null; station_name: string | null; receiver_name: string; images: number | null
  drape: string | null; signal: number
}

/** A page of passes, newest first: `before` (a pass's time) for the next page; `receiver`, and `station`
    (one of the receiver's places), to show only those. With the receivers and stations for the filters.
    Not seeing all: the main image is the public one, no image count and no signal. */
async function list(env: Env, url: URL, all: boolean): Promise<Response> {
  const before = Number(url.searchParams.get('before')) || null
  const receiver = url.searchParams.get('receiver') || null
  const station = url.searchParams.get('station') || null
  if (receiver !== null && !RECEIVER_ID.test(receiver)) throw new HttpError(400, 'no such receiver')
  const { results } = await env.DB.prepare(
    `SELECT p.receiver, p.id, p.time, p.satellite, ${all ? 'p.main' : PUBLIC_IMAGE} AS main, p.coverage,
       p.max_el, p.peak_snr, p.station_id, p.station_name, p.drape, p.signal, r.name AS receiver_name,
       ${all ? '(SELECT COUNT(*) FROM images i WHERE i.receiver = p.receiver AND i.pass = p.id)' : 'NULL'} AS images
     FROM passes p JOIN receivers r ON r.id = p.receiver
     WHERE (?1 IS NULL OR p.time < ?1) AND (?2 IS NULL OR p.receiver = ?2) AND (?3 IS NULL OR p.station_id = ?3)
     ORDER BY p.time DESC LIMIT ?4`,
  ).bind(before, receiver, station, PAGE + 1).all<PassRow>()
  const receivers = await env.DB.prepare('SELECT id, name FROM receivers ORDER BY name').all<{ id: string; name: string }>()
  const stations = await env.DB.prepare('SELECT receiver, id, name, lat, lon FROM stations ORDER BY name')
    .all<{ receiver: string; id: string; name: string; lat: number | null; lon: number | null }>()
  return json({
    passes: results.slice(0, PAGE).map(r => ({
      ...r, signal: all && !!r.signal, pass: r.id, id: passId(r.receiver, r.id),
    })),
    more: results.length > PAGE,
    receivers: receivers.results,
    stations: all ? stations.results : stations.results.map(s => ({ ...s, lat: rough(s.lat), lon: rough(s.lon) })),
  })
}

/** What everyone may see of pass.json: the facts the pass page shows; the sky track only with `track`. */
function publicMeta(meta: Record<string, unknown>, track: boolean) {
  const orbit = isObject(meta.orbit) ? { ...meta.orbit } : null
  if (orbit && !track) delete orbit.track
  return { coverage: num(meta.coverage), orbit, signal: isObject(meta.signal) ? meta.signal : null }
}

async function detail(env: Env, id: string, view: View) {
  const { receiver, pass } = splitPassId(id)
  const row = await env.DB.prepare(
    `SELECT p.time, p.satellite, p.main, ${PUBLIC_IMAGE} AS shown, p.meta, p.uploaded_at, p.station_id,
       p.station_name, p.lat, p.lon, p.drape, p.signal, r.name AS receiver_name
     FROM passes p JOIN receivers r ON r.id = p.receiver WHERE p.receiver = ? AND p.id = ?`,
  ).bind(receiver, pass).first<{
    time: number; satellite: string; main: string | null; shown: string | null; meta: string; uploaded_at: number
    station_id: string | null; station_name: string | null; lat: number | null; lon: number | null; receiver_name: string
    drape: string | null; signal: number
  }>()
  if (!row) throw new HttpError(404, 'no such pass')
  const all = view === 'full'
  const main = all ? row.main : row.shown
  const { results } = await env.DB.prepare(
    'SELECT path, name, variants, width, height FROM images WHERE receiver = ? AND pass = ? ORDER BY path',
  ).bind(receiver, pass).all<{ path: string; name: string | null; variants: string; width: number | null; height: number | null }>()
  // the main image first, the others by name; only the public one when not seeing all
  const images = results.filter(i => all || i.path === row.shown)
    .map(i => ({ ...i, variants: JSON.parse(i.variants || '[]') as string[] }))
    .sort((a, b) => Number(b.path === main) - Number(a.path === main))
  const meta = JSON.parse(row.meta) as Record<string, unknown>
  const signal = view !== 'public' && !!row.signal
  return {
    id, receiver: { id: receiver, name: row.receiver_name }, pass,
    station: row.station_id
      ? { id: row.station_id, name: row.station_name, lat: all ? row.lat : null, lon: all ? row.lon : null }
      : null,
    time: row.time, satellite: row.satellite, main, uploaded_at: row.uploaded_at,
    meta: all ? meta : publicMeta(meta, view === 'latest'), images, drape: row.drape, signal,
    // the sign-in page gets the chart in the same answer
    ...(view === 'latest' && { chart: signal ? await chartOf(env, receiver, pass) : null }),
  }
}

async function chartOf(env: Env, receiver: string, pass: string): Promise<unknown> {
  const object = await env.FILES.get(dataKey(receiver, pass, 'signal'))
  return object ? object.json() : null
}

/** The newest pass that has an image, as the sign-in page shows it; null while there is none. */
async function latest(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT receiver, id FROM passes WHERE main IS NOT NULL ORDER BY time DESC LIMIT 1')
    .first<{ receiver: string; id: string }>()
  return json(row ? await detail(env, passId(row.receiver, row.id), 'latest') : null)
}

async function file(request: Request, env: Env, all: boolean, receiver: string, pass: string, kind: Kind, path: string) {
  if (!all) {
    // the public image, and the one the globe drapes (the raw image the georeferencing describes; large only)
    const row = await env.DB.prepare(`SELECT p.drape, ${PUBLIC_IMAGE} AS shown FROM passes p WHERE p.receiver = ? AND p.id = ?`)
      .bind(receiver, pass).first<{ drape: string | null; shown: string | null }>()
    if (!row || !(path === row.shown || (kind === 'large' && path === row.drape))) {
      throw new HttpError(401, 'sign in to see every image')
    }
  }
  const object = await env.FILES.get(fileKey(receiver, pass, kind, path), { onlyIf: request.headers })
  if (!object) throw new HttpError(404, 'no such image')
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
    'Cache-Control': `${all ? 'private' : 'public'}, max-age=86400`,
    ETag: object.httpEtag,
  })
  return 'body' in object ? new Response(object.body, { headers }) : new Response(null, { status: 304, headers })
}

/** geo.json (where the image lies: the globe) or signal.json (the chart) of a pass, as the Pi sent it. */
async function data(request: Request, env: Env, id: string, name: DataName): Promise<Response> {
  const { receiver, pass } = splitPassId(id)
  const object = await env.FILES.get(dataKey(receiver, pass, name), { onlyIf: request.headers })
  if (!object) throw new HttpError(404, name === 'geo' ? 'this pass can\'t be placed on the globe' : 'no signal for this pass')
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=3600', ETag: object.httpEtag,
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
  if (path === '/api/passes' && method === 'GET') return list(env, url, await seesAll(request, env))
  if (path === '/api/latest' && method === 'GET') return latest(env)
  let m = match(path, /^\/api\/passes\/([^/]+)$/)
  if (m && method === 'GET') return json(await detail(env, m[0], (await seesAll(request, env)) ? 'full' : 'public'))
  if (m && method === 'DELETE') {
    await requireUser(request, env, 'admin')
    return remove(env, m[0])
  }
  m = match(path, /^\/api\/passes\/([^/]+)\/(geo|signal)$/)
  if (m && method === 'GET') {
    // the globe is public; the signal chart is not
    if (m[1] === 'signal') await requireUser(request, env, 'admin', 'viewer')
    return data(request, env, m[0], m[1] as DataName)
  }
  m = match(path, /^\/api\/files\/([^/]+)\/([^/]+)\/(thumb|large)\/(.+)\.jpg$/)
  if (m && method === 'GET') {
    if (!RECEIVER_ID.test(m[0])) throw new HttpError(404, 'no such image')
    return file(request, env, await seesAll(request, env), m[0], passName(m[1]), m[2] as Kind, imagePath(m[3]))
  }
  return null
}
