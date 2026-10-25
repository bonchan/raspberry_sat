// Receivers page (admins): each receiver is a Pi with its own token. Its id is the hub's (random, never
// changes, names its folder in R2); its name can change anytime. Adding one gives the upload URL and the
// token to paste into the Pi's Settings → Destinations.

import { requireUser } from './auth'
import type { Env } from './env'
import { deletePrefix, receiverPrefix } from './files'
import { HttpError, json, match, now, randomToken, readJson, sha256 } from './http'
import { RECEIVER_ID, newReceiverId } from './names'

interface Receiver { id: string; name: string }

/** What the Pi's settings need. The token is shown only in this answer. */
const link = (request: Request, receiver: Receiver, token: string) =>
  ({ ...receiver, url: new URL('/ingest', request.url).toString(), token })

function plainName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 60) throw new HttpError(400, 'give the receiver a name, up to 60 characters')
  return name
}

async function list(env: Env): Promise<Response> {
  const receivers = await env.DB.prepare(
    `SELECT r.id, r.name, r.created_at, r.revoked_at, r.last_seen,
       (SELECT COUNT(*) FROM passes p WHERE p.receiver = r.id) AS passes,
       (SELECT MAX(time) FROM passes p WHERE p.receiver = r.id) AS last_pass
     FROM receivers r ORDER BY r.name`,
  ).all<Receiver & Record<string, unknown>>()
  const stations = await env.DB.prepare(
    'SELECT receiver, id, name, last_pass FROM stations ORDER BY name',
  ).all<{ receiver: string; id: string; name: string; last_pass: number | null }>()
  return json(receivers.results.map(r => ({
    ...r,
    stations: stations.results.filter(s => s.receiver === r.id).map(({ receiver: _, ...s }) => s),
  })))
}

async function add(request: Request, env: Env): Promise<Response> {
  const name = plainName((await readJson<{ name?: unknown }>(request)).name)
  let id = newReceiverId()
  while (await env.DB.prepare('SELECT 1 FROM receivers WHERE id = ?').bind(id).first()) id = newReceiverId()
  const token = randomToken()
  await env.DB.prepare('INSERT INTO receivers (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, await sha256(token), now()).run()
  return json(link(request, { id, name }, token), 201)
}

/** A new token; the old one stops working at once. Also lets a revoked receiver in again. */
async function newToken(request: Request, env: Env, receiver: Receiver): Promise<Response> {
  const token = randomToken()
  await env.DB.prepare('UPDATE receivers SET token_hash = ?, revoked_at = NULL WHERE id = ?')
    .bind(await sha256(token), receiver.id).run()
  return json(link(request, receiver, token))
}

/** The receiver's files a batch at a time, then its rows. {done: false}: call again. */
async function remove(env: Env, receiver: Receiver): Promise<Response> {
  if (!(await deletePrefix(env.FILES, receiverPrefix(receiver.id)))) return json({ done: false })
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE receiver = ?').bind(receiver.id),
    env.DB.prepare('DELETE FROM passes WHERE receiver = ?').bind(receiver.id),
    env.DB.prepare('DELETE FROM stations WHERE receiver = ?').bind(receiver.id),
    env.DB.prepare('DELETE FROM receivers WHERE id = ?').bind(receiver.id),
  ])
  return json({ done: true })
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (path !== '/api/receivers' && !path.startsWith('/api/receivers/')) return null
  await requireUser(request, env, 'admin')

  if (path === '/api/receivers') {
    if (method === 'GET') return list(env)
    if (method === 'POST') return add(request, env)
    return null
  }

  const m = match(path, /^\/api\/receivers\/([^/]+)(\/token|\/revoke)?$/)
  if (!m || !RECEIVER_ID.test(m[0])) return null
  const [id, action] = m
  const receiver = await env.DB.prepare('SELECT id, name FROM receivers WHERE id = ?').bind(id).first<Receiver>()
  if (!receiver) throw new HttpError(404, 'no such receiver')

  if (action === '/token' && method === 'POST') return newToken(request, env, receiver)
  if (action === '/revoke' && method === 'POST') {
    await env.DB.prepare('UPDATE receivers SET revoked_at = ? WHERE id = ?').bind(now(), receiver.id).run()
    return json({ revoked: receiver.id })
  }
  if (action === '' && method === 'PATCH') {
    const name = plainName((await readJson<{ name?: unknown }>(request)).name)
    await env.DB.prepare('UPDATE receivers SET name = ? WHERE id = ?').bind(name, receiver.id).run()
    return json({ id: receiver.id, name })
  }
  if (action === '' && method === 'DELETE') return remove(env, receiver)
  return null
}
