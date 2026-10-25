/** An answer with an HTTP status and a message the page (or the station) can show as it is. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function readJson<T>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const text = await request.text()
  if (text.length > maxBytes) throw new HttpError(413, `the body is over ${maxBytes} bytes`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'the body must be JSON')
  }
}

export const now = () => Math.floor(Date.now() / 1000)

export function base64url(data: Uint8Array): string {
  let s = ''
  for (const b of data) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

/** Random, URL-safe: session cookies, station tokens, sign-in state. */
export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)))

/** Tokens and session cookies are stored only as this, so a copy of the database can't be used to sign in. */
export async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The decoded groups of `pattern` in `path` (a URL path, still encoded), or null when it doesn't match.
    Groups that matched nothing come back as "". */
export function match(path: string, pattern: RegExp): string[] | null {
  const m = pattern.exec(path)
  if (!m) return null
  return m.slice(1).map(g => {
    if (g === undefined) return ''
    try {
      return decodeURIComponent(g)
    } catch {
      throw new HttpError(400, 'bad URL')
    }
  })
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
