/** What the Worker is given (wrangler.jsonc, and secrets set in Cloudflare's dashboard). */
export interface Env {
  DB: D1Database
  FILES: R2Bucket
  /** the pages (dist/): pass pages are served through the Worker, for their link previews (preview.ts) */
  ASSETS: Fetcher
  /** the OAuth client made in Google Cloud for "Sign in with Google" (Worker secrets) */
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** role of everyone who signs in after the first: "pending" (default) or "viewer" */
  NEW_USER_ROLE?: string
}
