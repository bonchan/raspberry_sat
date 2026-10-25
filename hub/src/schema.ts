// The database's tables. The Worker sets them up itself on its first request, so nothing has to be run by
// hand in Cloudflare. A later change to the tables goes into a new entry at the end of MIGRATIONS.

const MIGRATIONS: string[][] = [
  [
    // people who signed in with Google; the first one became admin
    `CREATE TABLE IF NOT EXISTS users (
      sub        TEXT PRIMARY KEY,          -- Google's id for the account (stays when its email changes)
      email      TEXT NOT NULL,
      name       TEXT,
      picture    TEXT,
      role       TEXT NOT NULL CHECK (role IN ('admin', 'viewer', 'pending')),
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,          -- SHA-256 of the cookie's value
      user_sub   TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_sub)`,
    // stations that may upload, each with its own token
    `CREATE TABLE IF NOT EXISTS stations (
      id         TEXT PRIMARY KEY,          -- short id given when added: "roof"
      name       TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,      -- SHA-256 of the token; the token itself is shown once
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen  INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS passes (
      station     TEXT NOT NULL REFERENCES stations(id),
      id          TEXT NOT NULL,            -- the pass's folder name on the station
      time        REAL NOT NULL,
      satellite   TEXT NOT NULL,
      main        TEXT,                     -- path of the image shown on its card
      coverage    REAL,
      max_el      REAL,
      peak_snr    REAL,
      meta        TEXT NOT NULL,            -- the pass.json the station sent
      uploaded_at INTEGER NOT NULL,
      PRIMARY KEY (station, id)
    )`,
    `CREATE INDEX IF NOT EXISTS passes_time ON passes(time DESC)`,
    `CREATE INDEX IF NOT EXISTS passes_station_time ON passes(station, time DESC)`,
    // the images of a pass on the hub: a thumbnail and a large JPEG each, in R2
    `CREATE TABLE IF NOT EXISTS images (
      station  TEXT NOT NULL,
      pass     TEXT NOT NULL,
      path     TEXT NOT NULL,              -- SatDump's file in the pass folder: MSU-MR/msu_mr_rgb_MCIR_corrected.png
      name     TEXT,
      variants TEXT,                       -- JSON list: ["corrected"]
      width    INTEGER,
      height   INTEGER,
      PRIMARY KEY (station, pass, path),
      FOREIGN KEY (station, pass) REFERENCES passes(station, id) ON DELETE CASCADE
    )`,
  ],
  [
    // 2026-10-25: a token belongs to a receiver (a Pi), whose id the hub makes; each pass says which of the
    // Pi's stations (its places, Settings → Stations there) received it. Starts clean: the passes stored
    // before go (delete their receiver first, so its files in R2 go too); users and sessions stay.
    `DROP TABLE IF EXISTS images`,
    `DROP TABLE IF EXISTS passes`,
    `DROP TABLE IF EXISTS stations`,
    `CREATE TABLE receivers (
      id         TEXT PRIMARY KEY,          -- made by the hub, never changes; also its folder in R2
      name       TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,      -- SHA-256 of the token; the token itself is shown once
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen  INTEGER
    )`,
    // the places a receiver has received from, as its passes last told them
    `CREATE TABLE stations (
      receiver  TEXT NOT NULL REFERENCES receivers(id) ON DELETE CASCADE,
      id        TEXT NOT NULL,              -- the Pi's own id for it
      name      TEXT NOT NULL,
      lat REAL, lon REAL, alt REAL,
      last_pass REAL,                       -- name and position are those of the latest pass
      PRIMARY KEY (receiver, id)
    )`,
    `CREATE TABLE passes (
      receiver     TEXT NOT NULL REFERENCES receivers(id),
      id           TEXT NOT NULL,           -- the pass's folder name on the receiver
      time         REAL NOT NULL,
      satellite    TEXT NOT NULL,
      station_id   TEXT,                    -- where it was received, as it was then
      station_name TEXT,
      lat REAL, lon REAL,
      main         TEXT,                    -- path of the image shown on its card
      coverage     REAL,
      max_el       REAL,
      peak_snr     REAL,
      meta         TEXT NOT NULL,           -- the pass.json the receiver sent
      uploaded_at  INTEGER NOT NULL,
      PRIMARY KEY (receiver, id)
    )`,
    `CREATE INDEX passes_time ON passes(time DESC)`,
    `CREATE INDEX passes_receiver_time ON passes(receiver, time DESC)`,
    `CREATE INDEX passes_station_time ON passes(receiver, station_id, time DESC)`,
    `CREATE TABLE images (
      receiver TEXT NOT NULL,
      pass     TEXT NOT NULL,
      path     TEXT NOT NULL,              -- SatDump's file in the pass folder: MSU-MR/msu_mr_rgb_MCIR_corrected.png
      name     TEXT,
      variants TEXT,                       -- JSON list: ["corrected"]
      width    INTEGER,
      height   INTEGER,
      PRIMARY KEY (receiver, pass, path),
      FOREIGN KEY (receiver, pass) REFERENCES passes(receiver, id) ON DELETE CASCADE
    )`,
  ],
  [
    // 2026-10-25: the globe and the signal chart. geo.json (where the image lies) and signal.json (the signal
    // thinned for a chart) are in R2 next to the images; these say whether a pass has them.
    `ALTER TABLE passes ADD COLUMN drape TEXT`,                       // the image geo.json places
    `ALTER TABLE passes ADD COLUMN signal INTEGER NOT NULL DEFAULT 0`,
  ],
]

let ready: Promise<void> | null = null

/** Once per Worker instance: bring the tables up to date. */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch(e => {
    ready = null
    throw e
  })
  return ready
}

async function migrate(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)').run()
  const row = await db.prepare('SELECT MAX(version) AS v FROM schema_version').first<{ v: number | null }>()
  for (let v = row?.v ?? 0; v < MIGRATIONS.length; v++) {
    await db.batch([
      ...MIGRATIONS[v].map(sql => db.prepare(sql)),
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').bind(v + 1),
    ])
  }
}
