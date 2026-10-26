// The hub's Worker. Requests for the pages themselves never get here: Cloudflare serves them from dist/
// (wrangler.jsonc: run_worker_first only for /api, /auth, /ingest, and /passes for its link previews).

import * as auth from './auth'
import type { Env } from './env'
import * as gallery from './gallery'
import { HttpError, json } from './http'
import * as ingest from './ingest'
import * as preview from './preview'
import * as receivers from './receivers'
import { ensureSchema } from './schema'
import * as users from './users'

const routes = [auth.route, gallery.route, receivers.route, users.route, ingest.route]

/** Changes from the pages must come from the hub's own pages: the session cookie alone isn't enough. */
function sameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get('Origin')
  if (request.method !== 'GET' && request.method !== 'HEAD' && origin && origin !== url.origin) {
    throw new HttpError(403, 'not from this site')
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    // a pass page, with its link preview: the page itself whatever else fails
    const page = preview.route(request, env, url)
    if (page) return page
    try {
      if (url.pathname.startsWith('/api/')) sameOrigin(request, url)
      await ensureSchema(env.DB)
      for (const route of routes) {
        const response = await route(request, env, url)
        if (response) return response
      }
      return json({ error: 'not found' }, 404)
    } catch (e) {
      if (e instanceof HttpError) {
        // the sign-in page shows what went wrong, rather than a bare JSON answer
        if (url.pathname === '/auth/callback') return auth.redirect(`/signin?signin=${encodeURIComponent(e.message)}`)
        return json({ error: e.message }, e.status)
      }
      console.error(e)
      return json({ error: 'the hub failed; the Worker\'s logs in Cloudflare say why' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
