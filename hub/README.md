# raspberry_sat hub

One website for the passes of several stations: an image gallery behind a Google sign-in. A Cloudflare
Worker serves the pages, their API and the stations' uploads; R2 keeps the images, D1 the rest. The plan,
decisions and the upload protocol are in [docs/SYNC_PLAN.md](../docs/SYNC_PLAN.md).

## How it gets updated

Cloudflare builds and deploys this folder from GitHub on each push to `main` that touches `hub/` or
`frontend/` (Workers Builds, root directory `hub`, build command
`pnpm install --frozen-lockfile && pnpm run build`, deploy command `npx wrangler deploy`). The database tables are created and updated by the Worker itself
(`src/schema.ts`); nothing has to be run by hand.

## Settings

- `wrangler.jsonc`: the D1 database's ID, the R2 bucket's name, `NEW_USER_ROLE` (`pending` or `viewer`: what
  people get when they first sign in; the very first one becomes admin).
- Secrets, in Cloudflare (Worker → Settings → Variables and Secrets): `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, from a Google Cloud OAuth client (type Web application) whose authorized redirect
  URIs are `https://raspberry-sat-hub.<subdomain>.workers.dev/auth/callback` and, for trying it locally,
  `http://localhost:8787/auth/callback`.

## Roles

| Role | Can |
|---|---|
| admin | everything: the gallery, Receivers (add, rename, new token, revoke, delete), Users (roles), delete passes |
| viewer | the gallery |
| pending | nothing yet: waits for an admin |

## Trying it locally

Needs Node 22 or newer (Wrangler doesn't run on older ones).

```bash
pnpm install
pnpm build
```

Put the Google client in `.dev.vars` (not in git):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Then, in two terminals, `pnpm watch` (rebuilds the pages) and `pnpm dev` (the Worker with a local database and
bucket at <http://localhost:8787>).
