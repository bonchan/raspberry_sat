// Types mirror backend/app/config.py; keep the two in step.

/** id: permanent, made by the app when the station is saved ('' for a new one); each pass keeps it */
export interface Station { id: string; name: string; lat: number; lon: number; alt: number }
export interface Sdr {
  source: string; source_id: string; samplerate: number; gain: number
  agc: boolean; bias: boolean; ppm_correction: number
}
export interface Satellite {
  name: string; norad: number; frequency_hz: number; pipeline: string
  min_elevation: number; enabled: boolean
}
export interface Tracking { min_elevation: number; stop_sdr_when_idle: boolean }
export interface Rotator { enabled: boolean; address: string; port: number }
/** auto: each pass is posted once processed; manual: a button on the pass page */
export type DiscordMode = 'off' | 'auto' | 'manual'
export interface Discord {
  mode: DiscordMode; application_id: string; bot_token: string; channel_id: string
  composites: string[]; post_failed: boolean
}
/** auto: each finished pass; manual: a button on the pass page; both: each pass, and the button to send it again */
export type DestinationMode = 'off' | 'auto' | 'manual' | 'both'
/** each finished pass goes by itself */
export const automatic = (d: { mode: DestinationMode }) => d.mode === 'auto' || d.mode === 'both'
/** a website collecting passes from several stations, such as the raspberry-sat hub (backend/app/destinations.py) */
export interface Destination {
  name: string; url: string; token: string; mode: DestinationMode
  images: string[]                  // like Discord's composites; empty: one per composite
  full_size: boolean; delete_after_upload: boolean
  since: number                     // set by the app: automatic sending takes passes finished after it
}
export interface Storage { keep_days: number; max_gb: number; keep_baseband: boolean }
export interface Display { show_low_passes: boolean; language: 'en' | 'es'; upcoming_days: number }

export interface Config {
  stations: Station[]; active_station: number   // index of the station SatDump uses
  sdr: Sdr; satellites: Satellite[]; tracking: Tracking
  rotator: Rotator; discord: Discord; destinations: Destination[]; storage: Storage; display: Display
}

export interface SystemInfo {
  hostname: string; version: string; data_dir: string
  disk: { total: number; used: number; free: number }
  // each null off the Pi (or when the tool behind it is missing)
  temperature: number | null                      // °C
  memory: { total: number; used: number } | null  // bytes; the page cache counts as free
  cpu: { usage: number; cores: number | null } | null   // share in use, all cores together, since the last poll
  uptime: number | null                           // seconds since boot
  throttling: { now: ThrottleFlag[]; since_boot: ThrottleFlag[] } | null
  clock_synced: boolean | null                    // set from the network (NTP)
  network: { ethernet: boolean; wifi: { ssid: string; signal: number } | null } | null  // signal 0-100 %
}
export type ThrottleFlag = 'under_voltage' | 'freq_capped' | 'throttled' | 'soft_temp_limit'

export type SatdumpState = 'stopped' | 'running' | 'stopping' | 'waiting' | 'not_installed'
export interface SatdumpProcess {
  state: SatdumpState; wanted: boolean; pid: number | null; started_at: number | null
  exit_code: number | null; restart_pending: boolean; restart_reason: string
}
export interface AzEl { az: number; el: number }
// SatDump's own /api, passed through (times are unix seconds)
export interface ObjectTracker {
  object_name: string; sat_current_pos: AzEl; sat_current_range?: number
  next_aos_time: number; next_los_time: number; next_event_is_aos: boolean; next_event_in: number
  rotator_engaged: boolean; rotator_tracking: boolean; rot_current_pos: AzEl; rot_current_req_pos: AzEl
}
export interface SatdumpApi { object_tracker: ObjectTracker; frequency: number; recording?: { written_size: number } }
export interface Status {
  satdump: SatdumpProcess; tracker: SatdumpApi | null; tracker_age: number | null
  receiving: boolean      // SatDump is decoding/recording a pass
  overhead: boolean       // the tracked satellite is up, recorded or not (low passes are skipped)
}
export interface LogLine { seq: number; time: number; level: string; source: string; text: string }

export interface PassImage {
  path: string; instrument: string; name: string; variants: string[]; bytes: number
  width?: number; height?: number; mean?: number; coverage?: number; error?: string
  gone?: boolean                    // deleted from the Pi after upload: only its thumbnail is left (pass page)
}
// null for passes finished before these were saved (signal), or that no orbit matched
export interface PassSummary {
  id: string; satellite: string; time: number; main: string | null
  coverage: number | null; image_count: number; size: number
  max_el: number | null; peak_snr: number | null; mean_snr: number | null; locked: number | null
  first_sync: SyncPoint | null; last_sync: SyncPoint | null      // where reception started and ended
  drops: SyncDrop[] | null                 // losses of sync between them
  tracked: Record<string, number> | null   // seconds of reception per 10° of elevation ("0", "10"... "80")
  discord_url: string | null        // the Discord message, once posted
  hubs: Record<string, string>      // destination name -> the pass's page there, once sent
  slimmed: boolean                  // deleted from the Pi but the main image, after upload
}
export interface SyncPoint { t: number; el: number | null; az: number | null }
/** a loss of sync during a pass: where, how long, and the median SNR before and during it */
export interface SyncDrop {
  t: number; el: number | null; az: number | null; seconds: number; snr_before: number | null; snr_during: number | null
}
/** where a pass's image lies: lat/lon for a grid of its pixels (rows x cols, row by row; null: no data) */
export interface PassGeo {
  image: string; width: number; height: number; rows: number[]; cols: number[]; points: ([number, number] | null)[]
}
/** the station and the TLEs of the satellites in the settings, for the globe */
export interface TleSet {
  station: { name: string; lat: number; lon: number; alt: number }
  satellites: { name: string; norad: number; enabled: boolean; line1: string; line2: string }[]
  missing: string[]
}
/** a pass's signal thinned for a small chart, with its span and elevation track */
export interface PassSignalThumb {
  start: number | null; end: number | null; track: [number, number][] | null; samples: LiveSample[]
  can_rebuild: boolean          // no signal saved, but SatDump's line time stamps can rebuild part of it
}
/** the pass as the orbits describe it; track is [az, el] every 10 s from AOS to LOS */
export interface PassOrbit {
  norad: number; aos: number; los: number; tca: number; max_el: number
  aos_az: number; los_az: number; track: [number, number][]
}
/** SNR in dB; locked: share of the recording with the deframer locked */
/** SNR null when rebuilt: rebuilt from line time stamps after the live signal was lost (no SNR then) */
export interface PassSignal {
  peak_snr: number | null; mean_snr: number | null; locked: number | null; seconds: number; rebuilt?: boolean
}
/** where a message went; channel is its name */
export interface DiscordSent { url: string; channel: string | null }
/** a pass on Discord: set when it was posted, error when the last try failed (an earlier post stays noted) */
export interface PassDiscord extends Partial<DiscordSent> {
  posted_at?: number; images?: number; error?: string; failed_at?: number
}
/** a pass on a destination: uploaded_at and url once there; error, attempts and next_try when the last try failed */
export interface PassHub {
  id?: string; url?: string; uploaded_at?: number; images?: number
  error?: string; failed_at?: number; attempts?: number; next_try?: number
}
export interface PassDetail {
  id: string; satellite: string; time: number; main: string | null; coverage: number | null
  size: number; source_name: string; images: PassImage[]; files: { path: string; bytes: number }[]
  orbit?: PassOrbit | null; signal?: PassSignal | null
  samples: LiveSample[]             // one per second while it was received; empty for older passes
  discord?: PassDiscord             // missing until it is first posted
  hubs?: Record<string, PassHub>    // per destination name, once tried
  // deleted from the Pi but the main image, once it was on this destination
  slimmed?: { at: number; destination: string; url: string | null; freed: number }
}
export interface PassList { passes: PassSummary[]; in_progress: { id: string; last_activity: number }[] }

/** a predicted pass; track is [az, el] every 10 s from AOS to LOS */
export interface UpcomingPass {
  name: string; norad: number; aos: number; los: number; tca: number; max_el: number
  aos_az: number; los_az: number; track: [number, number][]; scheduled: boolean
}
export interface Schedule {
  passes: UpcomingPass[]; computed_at?: number; days?: number; tle_updated_at?: number; missing?: string[]; error?: string
}
/** one sample per second during a pass; signal fields only while SatDump's pipeline reports them */
export interface LiveSample {
  t: number; az?: number; el?: number; snr?: number; peak_snr?: number; freq?: number
  viterbi_ber?: number; viterbi_lock?: number | boolean; deframer_lock?: boolean; rs_avg?: number
}
/** the current (or last) pass as it happens: the latest reading and the data received so far */
export interface LiveState {
  receiving: boolean; pass_started: number; last_los: number
  current: LiveSample | null        // the latest reading; the samples keep one a second
  folder: string | null; cadu_bytes: number
}
/** SatDump's spectrum: dB across the band (null: below the scale), the tuned frequency in the middle */
export interface Spectrum {
  db: (number | null)[]; min: number; max: number; frequency: number | null; samplerate: number; time: number
}

export interface CommitInfo { hash: string; short: string; time: number; subject: string }
export interface PendingCommit extends CommitInfo {
  author: string; body: string; files: { status: string; path: string }[]
  affects_pi: boolean       // changes a file the Pi uses, not only what not_on_pi lists
}
export interface UpdateState {
  checked_at?: number; error?: string | null
  current?: CommitInfo | null; branch?: string | null; upstream?: string | null
  behind?: number; ahead?: number; commits?: PendingCommit[]; diffstat?: string; dirty?: string[]
  pi_changes?: number       // files pulling would change that the Pi uses; 0: nothing to update
  not_on_pi?: string[]      // what the Pi doesn't use: "hub/", "docs/", "arduino/", "README.md"
  running: boolean
  // pull_only: nothing the Pi uses had changed, so nothing was rebuilt or restarted
  last_run: { log: string[]; result: 'ok' | 'failed' | null; changed_at: number; pull_only?: boolean } | null
  blocked: UpdateBlocker | null     // why Update now has to wait for a pass
}
export type UpdateBlocker =
  | { reason: 'receiving' | 'decoding'; message: string }
  | { reason: 'pass_soon'; satellite: string; aos: number; message: string }

export interface NetDevice { device: string; type: 'wifi' | 'ethernet'; connected: boolean; state: string; connection: string }
export interface SavedNetwork { uuid: string; name: string; ssid: string; autoconnect: boolean; priority: number; active: boolean }
export interface NetworksState { devices: NetDevice[]; saved: SavedNetwork[]; error: string | null }
export interface NearbyNetwork { ssid: string; signal: number; security: string; in_use: boolean }
export interface NewNetwork { ssid: string; password: string; priority: number; hidden: boolean; security: '' | 'wpa-psk' | 'sae' }

export interface ReceiverCheck { id: string; status: 'ok' | 'warn' | 'fail'; detail: string; reason: string | null }
export interface ReceiverTest {
  source: string; supported: boolean; ok: boolean | null; checks: ReceiverCheck[]
  gains: number[]; effective_gain: number | null; output: string
}

export class ApiError extends Error {
  constructor(message: string, public details: string[] = []) { super(message) }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.ok) return res.json() as Promise<T>
  let details: string[] = []
  try {
    const data = await res.json()
    // FastAPI validation errors: detail is a list of { loc: [...], msg }
    if (Array.isArray(data.detail)) {
      details = data.detail.map((d: { loc: (string | number)[]; msg: string }) =>
        d.loc.filter(p => p !== 'body').join('.') + ': ' + d.msg)
    } else if (data.detail) {
      details = [String(data.detail)]
    }
  } catch { /* not JSON */ }
  throw new ApiError(`${method} ${path} failed (${res.status})`, details)
}

/** the pass being worked on after LOS (topic "processing"); percent is null while there is nothing to go by */
export interface Processing {
  pass: string
  satellite: string | null
  step: 'decode' | 'images' | 'thumbnails'
  percent: number | null
}

export const api = {
  getConfig: () => request<Config>('GET', '/config'),
  getStatus: () => request<Status>('GET', '/status'),
  putConfig: (config: Config) => request<Config>('PUT', '/config', config),
  satdump: (action: 'start' | 'stop' | 'restart') => request<SatdumpProcess>('POST', `/satdump/${action}`),
  getSatdumpConfig: () => request<unknown>('GET', '/satdump/config'),
  testReceiver: (sdr: Sdr) => request<ReceiverTest>('POST', '/receiver/test', sdr),
  getNetworks: () => request<NetworksState>('GET', '/networks'),
  scanNetworks: () => request<{ networks: NearbyNetwork[] }>('GET', '/networks/scan'),
  saveNetwork: (n: NewNetwork) => request<{ result: 'added' | 'updated' }>('POST', '/networks', n),
  setNetworkPriority: (uuid: string, priority: number) =>
    request<{ uuid: string }>('PATCH', `/networks/${encodeURIComponent(uuid)}`, { priority }),
  forgetNetwork: (uuid: string) => request<{ forgotten: string }>('DELETE', `/networks/${encodeURIComponent(uuid)}`),
  power: (action: 'restart-app' | 'reboot' | 'poweroff') => request<{ action: string }>('POST', `/system/${action}`),
  checkUpdate: () => request<UpdateState>('POST', '/update/check'),
  applyUpdate: () => request<UpdateState>('POST', '/update/apply'),
  getPass: (id: string) => request<PassDetail>('GET', `/passes/${encodeURIComponent(id)}`),
  getPassGeo: (id: string) => request<PassGeo>('GET', `/passes/${encodeURIComponent(id)}/geo`),
  getPassSignal: (id: string) => request<PassSignalThumb>('GET', `/passes/${encodeURIComponent(id)}/signal?points=150`),
  rebuildPassSignal: (id: string) => request<PassSignalThumb>('POST', `/passes/${encodeURIComponent(id)}/signal/rebuild`),
  deletePass: (id: string) => request<{ deleted: string }>('DELETE', `/passes/${encodeURIComponent(id)}`),
  // both start in the background and answer at once; the topic "jobs" shows them running ({started: false}:
  // running already), the pass's notes the result
  postPass: (id: string) => request<{ started: boolean }>('POST', `/passes/${encodeURIComponent(id)}/discord`),
  testDiscord: (discord: Discord) => request<DiscordSent>('POST', '/discord/test', discord),
  testDestination: (d: Destination) =>
    // receiver: which Pi this token is on the hub; hubs from before receivers answer "station"
    request<{ receiver?: { id: string; name: string }; station?: { id: string; name: string }; protocol: number }>(
      'POST', '/destinations/test', d),
  sendOlder: (name: string) => request<{ queued: number }>('POST', `/destinations/${encodeURIComponent(name)}/older`),
  sendToDestination: (id: string, name: string) =>
    request<{ started: boolean }>('POST', `/passes/${encodeURIComponent(id)}/destinations/${encodeURIComponent(name)}`),
}

/** the topic "jobs" (backend/app/jobs.py): posting and sending in progress; target "discord" or "hub:<name>" */
export interface Jobs { running: { pass: string; target: string; started_at: number; by_hand: boolean }[] }

// what the bot may do in the server it is added to: View Channels, Send Messages, Attach Files
const BOT_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 15)

/** Discord's page for adding the bot to a server */
export const discordInvite = (applicationId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot&permissions=${BOT_PERMISSIONS}`

// image paths contain spaces and brackets: encode each part, keep the slashes
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** thumb: small preview; large: screen-sized JPEG; file: SatDump's original file */
export const passFile = (id: string, kind: 'thumb' | 'large' | 'file', path: string) =>
  `/api/passes/${encodeURIComponent(id)}/${kind}/${encodePath(path)}`

export const satdumpImage = (name: 'polarplot' | 'schedule' | 'fft', tick: number) =>
  `/api/satdump/${name}.jpeg?t=${tick}`
