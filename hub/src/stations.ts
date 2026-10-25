// Stations page (admins): add a station (it gets the upload URL and a token to paste into its settings),
// give it a new token, revoke it, delete it with its passes.

import { requireUser } from './auth'
import type { Env } from './env'
import { deletePrefix, stationPrefix } from './files'
import { HttpError, json, match, now, randomToken, readJson, sha256 } from './http'
import { STATION_ID } from './names'

interface Station { id: string; name: string }

/** What the station's settings need. The token is shown only in this answer. */
const link = (request: Request, station: Station, token: string) =>
  ({ ...station, url: new URL('/ingest', request.url).toString(), token })

async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.created_at, s.revoked_at, s.last_seen,
       (SELECT COUNT(*) FROM passes p WHERE p.station = s.id) AS passes,
       (SELECT MAX(time) FROM passes p WHERE p.station = s.id) AS last_pass
     FROM stations s ORDER BY s.name`,
  ).all()
  return json(results)
}

async function add(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ id?: unknown; name?: unknown }>(request)
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!STATION_ID.test(id)) {
    throw new HttpError(400, 'the id takes lowercase letters, digits and dashes, up to 32: "roof", "casa-2"')
  }
  if (!name || name.length > 60) throw new HttpError(400, 'give the station a name, up to 60 characters')
  if (await env.DB.prepare('SELECT 1 FROM stations WHERE id = ?').bind(id).first()) {
    throw new HttpError(409, `there is already a station with the id "${id}"`)
  }
  const token = randomToken()
  await env.DB.prepare('INSERT INTO stations (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, await sha256(token), now()).run()
  return json(link(request, { id, name }, token), 201)
}

/** A new token; the old one stops working at once. Also lets a revoked station in again. */
async function newToken(request: Request, env: Env, station: Station): Promise<Response> {
  const token = randomToken()
  await env.DB.prepare('UPDATE stations SET token_hash = ?, revoked_at = NULL WHERE id = ?')
    .bind(await sha256(token), station.id).run()
  return json(link(request, station, token))
}

/** The station's files a batch at a time, then its rows. {done: false}: call again. */
async function remove(env: Env, station: Station): Promise<Response> {
  if (!(await deletePrefix(env.FILES, stationPrefix(station.id)))) return json({ done: false })
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE station = ?').bind(station.id),
    env.DB.prepare('DELETE FROM passes WHERE station = ?').bind(station.id),
    env.DB.prepare('DELETE FROM stations WHERE id = ?').bind(station.id),
  ])
  return json({ done: true })
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (path !== '/api/stations' && !path.startsWith('/api/stations/')) return null
  await requireUser(request, env, 'admin')

  if (path === '/api/stations') {
    if (method === 'GET') return list(env)
    if (method === 'POST') return add(request, env)
    return null
  }

  const m = match(path, /^\/api\/stations\/([^/]+)(\/token|\/revoke)?$/)
  if (!m) return null
  const [id, action] = m
  const station = await env.DB.prepare('SELECT id, name FROM stations WHERE id = ?').bind(id).first<Station>()
  if (!station) throw new HttpError(404, 'no such station')

  if (action === '/token' && method === 'POST') return newToken(request, env, station)
  if (action === '/revoke' && method === 'POST') {
    await env.DB.prepare('UPDATE stations SET revoked_at = ? WHERE id = ?').bind(now(), station.id).run()
    return json({ revoked: station.id })
  }
  if (action === '' && method === 'DELETE') return remove(env, station)
  return null
}
