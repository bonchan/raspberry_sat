// Link previews. Chat apps (WhatsApp, Telegram, Discord...) read a shared link's HTML; they don't run the
// page's JavaScript. So a pass page (/passes/<id>) is the app's page (dist/index.html, from the static
// assets) with Open Graph tags added to its head: the pass's public image (its MCIR corrected thumbnail),
// the satellite and station, and the time. In no particular language (the apps send none): the time in UTC.
// Whatever fails, the page itself is still served.

import type { Env } from './env'
import { PUBLIC_IMAGE } from './gallery'
import { splitPassId } from './names'

const THUMB_WIDTH = 480        // the Pi's thumbnails (backend/app/passes.py): small enough for every app
const SITE = 'raspberry_sat hub'

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const enc = encodeURIComponent

/** The pass's preview tags, or null when there is no such pass. */
async function tags(env: Env, id: string, url: URL): Promise<string | null> {
  const { receiver, pass } = splitPassId(id)
  const row = await env.DB.prepare(
    `SELECT p.time, p.satellite, p.max_el, p.peak_snr, p.station_name, r.name AS receiver_name, ${PUBLIC_IMAGE} AS shown
     FROM passes p JOIN receivers r ON r.id = p.receiver WHERE p.receiver = ? AND p.id = ?`,
  ).bind(receiver, pass).first<{
    time: number; satellite: string; max_el: number | null; peak_snr: number | null
    station_name: string | null; receiver_name: string; shown: string | null
  }>()
  if (!row) return null

  // "METEOR-M2 3 · Roof", "2026-10-25 13:10 UTC · max 54° · SNR 9.8 dB"
  const title = `${row.satellite} · ${row.station_name ?? row.receiver_name}`
  const description = [
    new Date(row.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    row.max_el !== null && `max ${Math.round(row.max_el)}°`,
    row.peak_snr !== null && `SNR ${row.peak_snr.toFixed(1)} dB`,
  ].filter(Boolean).join(' · ')
  const meta: [string, string][] = [
    ['og:type', 'website'], ['og:site_name', SITE], ['og:title', title], ['og:description', description],
    ['og:url', url.toString()],
  ]
  if (row.shown) {
    // the same address the pages use (web/src/api.ts fileUrl); public, so the apps can fetch it
    const image = `${url.origin}/api/files/${enc(receiver)}/${enc(pass)}/thumb/${row.shown.split('/').map(enc).join('/')}.jpg`
    meta.push(['og:image', image], ['og:image:type', 'image/jpeg'], ['og:image:alt', title])
    const size = await env.DB.prepare('SELECT width, height FROM images WHERE receiver = ? AND pass = ? AND path = ?')
      .bind(receiver, pass, row.shown).first<{ width: number | null; height: number | null }>()
    if (size?.width && size.height) {
      const width = Math.min(size.width, THUMB_WIDTH)
      meta.push(['og:image:width', String(width)], ['og:image:height', String(Math.round(size.height * width / size.width))])
    }
  }
  return [
    ...meta.map(([property, content]) => `<meta property="${property}" content="${escape(content)}">`),
    `<meta name="description" content="${escape(description)}">`,
    `<meta name="twitter:card" content="${row.shown ? 'summary_large_image' : 'summary'}">`,
  ].join('\n    ')
}

/** /passes/<id>: the app's page, with the pass's preview tags in its head. */
export async function passPage(request: Request, env: Env, url: URL): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', url), { method: request.method }))
  if (request.method !== 'GET' || !page.ok) return page
  let head: string | null = null
  try {
    const id = decodeURIComponent(url.pathname.slice('/passes/'.length).replace(/\/$/, ''))
    head = await tags(env, id, url)
  } catch {
    // a malformed id, or the database not answering: the page as it is (it shows what's wrong)
  }
  if (!head) return page
  const response = new HTMLRewriter()
    .on('head', { element: e => { e.append(`    ${head}\n  `, { html: true }) } })
    .transform(page)
  const headers = new Headers(response.headers)
  headers.delete('ETag')          // index.html's; this page differs per pass
  headers.set('Cache-Control', 'no-cache')
  return new Response(response.body, { status: response.status, headers })
}

export function route(request: Request, env: Env, url: URL): Promise<Response> | null {
  if (!/^\/passes\/[^/]+\/?$/.test(url.pathname)) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  return passPage(request, env, url)
}
