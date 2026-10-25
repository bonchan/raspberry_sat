// Users page (admins): who signed in, and their roles.

import { ROLES, requireUser, type Role } from './auth'
import type { Env } from './env'
import { HttpError, json, match, readJson } from './http'

async function keepAnAdmin(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>()
  if ((row?.n ?? 0) < 2) throw new HttpError(409, 'the hub needs an admin: make someone else admin first')
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (path !== '/api/users' && !path.startsWith('/api/users/')) return null
  await requireUser(request, env, 'admin')

  if (path === '/api/users') {
    if (method !== 'GET') return null
    const { results } = await env.DB.prepare(
      'SELECT sub, email, name, role, created_at, last_login FROM users ORDER BY created_at',
    ).all()
    return json(results)
  }

  const m = match(path, /^\/api\/users\/([^/]+)$/)
  if (!m) return null
  const sub = m[0]
  const user = await env.DB.prepare('SELECT sub, role FROM users WHERE sub = ?').bind(sub).first<{ sub: string; role: Role }>()
  if (!user) throw new HttpError(404, 'no such user')

  if (method === 'PATCH') {
    const { role } = await readJson<{ role?: unknown }>(request)
    if (!ROLES.includes(role as Role)) throw new HttpError(400, 'the role must be admin, viewer or pending')
    if (user.role === 'admin' && role !== 'admin') await keepAnAdmin(env)
    await env.DB.prepare('UPDATE users SET role = ? WHERE sub = ?').bind(role, sub).run()
    return json({ sub, role })
  }
  if (method === 'DELETE') {
    if (user.role === 'admin') await keepAnAdmin(env)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_sub = ?').bind(sub),
      env.DB.prepare('DELETE FROM users WHERE sub = ?').bind(sub),
    ])
    return json({ removed: sub })
  }
  return null
}
