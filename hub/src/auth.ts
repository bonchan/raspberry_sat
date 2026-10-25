// "Sign in with Google" (OpenID Connect, done by the Worker itself) and sessions. The first person to sign
// in becomes admin; everyone after gets NEW_USER_ROLE ("pending" unless set to "viewer") until an admin
// gives them another role on the Users page.

import type { Env } from './env'
import { HttpError, fromBase64url, json, now, randomToken, sha256 } from './http'

export type Role = 'admin' | 'viewer' | 'pending'
export const ROLES: Role[] = ['admin', 'viewer', 'pending']

export interface User { sub: string; email: string; name: string | null; picture: string | null; role: Role }

const SESSION_COOKIE = 'raspberry_sat_session'
const STATE_COOKIE = 'raspberry_sat_signin'
const SESSION_SECONDS = 30 * 86400
const STATE_SECONDS = 600
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

function cookie(name: string, value: string, maxAge: number, path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

function googleClient(env: Env): { id: string; secret: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(500, 'Google sign-in is not set up yet: add the secrets GOOGLE_CLIENT_ID and ' +
      'GOOGLE_CLIENT_SECRET to the Worker (Settings → Variables and Secrets)')
  }
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
}

// the same address Google Cloud has as an authorized redirect URI
const callbackUrl = (request: Request) => new URL('/auth/callback', request.url).toString()

function startSignIn(request: Request, env: Env): Response {
  const client = googleClient(env)
  const state = randomToken(16)
  const url = new URL(GOOGLE_AUTH)
  url.search = new URLSearchParams({
    client_id: client.id, redirect_uri: callbackUrl(request), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  }).toString()
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, STATE_SECONDS, '/auth')])
}

interface IdClaims {
  iss: string; aud: string; exp: number; sub: string
  email?: string; email_verified?: boolean | string; name?: string; picture?: string
}

/** The ID token's claims. Its signature isn't checked: the token came straight from Google's token
    endpoint over HTTPS, in exchange for the client secret (OpenID Connect Core, 3.1.3.7). */
function idClaims(token: unknown, clientId: string): IdClaims {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) throw new HttpError(502, 'Google sent no ID token')
  const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as IdClaims
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new HttpError(502, 'the ID token is not from Google')
  }
  if (claims.aud !== clientId) throw new HttpError(502, 'the ID token is for another app')
  if (claims.exp < now()) throw new HttpError(502, 'the ID token has expired')
  if (!claims.email || String(claims.email_verified) !== 'true') {
    throw new HttpError(403, 'this Google account has no verified email')
  }
  return claims
}

async function finishSignIn(request: Request, env: Env, url: URL): Promise<Response> {
  const clearState = cookie(STATE_COOKIE, '', 0, '/auth')
  if (url.searchParams.get('error')) return redirect('/?signin=cancelled', [clearState])
  const state = url.searchParams.get('state'), code = url.searchParams.get('code')
  if (!state || !code || state !== readCookie(request, STATE_COOKIE)) {
    throw new HttpError(400, 'the sign-in expired or did not start here; try again')
  }
  const client = googleClient(env)
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    body: new URLSearchParams({
      code, client_id: client.id, client_secret: client.secret,
      redirect_uri: callbackUrl(request), grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) throw new HttpError(502, `Google refused the sign-in (${r.status})`)
  const claims = idClaims((await r.json<{ id_token?: string }>()).id_token, client.id)

  const t = now()
  const newRole: Role = env.NEW_USER_ROLE === 'viewer' ? 'viewer' : 'pending'
  const token = randomToken()
  await env.DB.batch([
    // the very first person becomes admin; later sign-ins keep the role they have
    env.DB.prepare(
      `INSERT INTO users (sub, email, name, picture, role, created_at, last_login)
       VALUES (?1, ?2, ?3, ?4, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE ?5 END, ?6, ?6)
       ON CONFLICT (sub) DO UPDATE SET email = excluded.email, name = excluded.name,
         picture = excluded.picture, last_login = excluded.last_login`,
    ).bind(claims.sub, claims.email, claims.name ?? null, claims.picture ?? null, newRole, t),
    env.DB.prepare('DELETE FROM sessions WHERE user_sub = ? AND expires_at < ?').bind(claims.sub, t),
    env.DB.prepare('INSERT INTO sessions (id, user_sub, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), claims.sub, t + SESSION_SECONDS),
  ])
  return redirect('/', [cookie(SESSION_COOKIE, token, SESSION_SECONDS), clearState])
}

async function signOut(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run()
  const response = json({ ok: true })
  response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0))
  return response
}

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  return env.DB.prepare(
    `SELECT u.sub, u.email, u.name, u.picture, u.role FROM sessions s JOIN users u ON u.sub = s.user_sub
     WHERE s.id = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), now()).first<User>()
}

/** The signed-in user, when their role is one of `roles`. */
export async function requireUser(request: Request, env: Env, ...roles: Role[]): Promise<User> {
  const user = await currentUser(request, env)
  if (!user) throw new HttpError(401, 'sign in first')
  if (!roles.includes(user.role)) {
    throw new HttpError(403, user.role === 'pending' ? 'an admin has to let you in first' : 'only admins can do that')
  }
  return user
}

export async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method
  if (path === '/auth/login' && method === 'GET') return startSignIn(request, env)
  if (path === '/auth/callback' && method === 'GET') return finishSignIn(request, env, url)
  if (path === '/auth/logout' && method === 'POST') return signOut(request, env)
  if (path === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env)
    return user ? json(user) : json({ error: 'not signed in' }, 401)
  }
  return null
}
