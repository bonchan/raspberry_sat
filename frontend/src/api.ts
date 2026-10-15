// Types mirror backend/app/config.py; keep the two in step.

export interface Station { name: string; lat: number; lon: number; alt: number }
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
export interface Discord { enabled: boolean; webhook_url: string; composites: string[]; post_failed: boolean }
export interface Storage { keep_days: number; max_gb: number; keep_baseband: boolean }
export interface Display { show_low_passes: boolean; language: 'en' | 'es'; upcoming_days: number }

export interface Config {
  stations: Station[]; active_station: number   // index of the station SatDump uses
  sdr: Sdr; satellites: Satellite[]; tracking: Tracking
  rotator: Rotator; discord: Discord; storage: Storage; display: Display
}

export interface SystemInfo {
  hostname: string; version: string; data_dir: string
  disk: { total: number; used: number; free: number }
}

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
}
export interface PassSummary {
  id: string; satellite: string; time: number; main: string | null
  coverage: number | null; image_count: number; size: number
}
export interface PassDetail {
  id: string; satellite: string; time: number; main: string | null; coverage: number | null
  size: number; source_name: string; images: PassImage[]; files: { path: string; bytes: number }[]
}
export interface PassList { passes: PassSummary[]; in_progress: { id: string; last_activity: number }[] }

/** a predicted pass; track is [az, el] every 10 s from AOS to LOS */
export interface UpcomingPass {
  name: string; norad: number; aos: number; los: number; tca: number; max_el: number
  aos_az: number; los_az: number; track: [number, number][]; scheduled: boolean
}
export interface Schedule {
  passes: UpcomingPass[]; computed_at: number; days?: number; tle_updated_at?: number; missing?: string[]; error?: string
}
/** one sample per second during a pass; signal fields only while SatDump's pipeline reports them */
export interface LiveSample {
  t: number; az?: number; el?: number; snr?: number; peak_snr?: number; freq?: number
  viterbi_ber?: number; viterbi_lock?: number | boolean; deframer_lock?: boolean; rs_avg?: number
}
export interface Live {
  receiving: boolean; pass_started: number; last_los: number; history: LiveSample[]
  folder: string | null; cadu_bytes: number
}

export interface CommitInfo { hash: string; short: string; time: number; subject: string }
export interface PendingCommit extends CommitInfo {
  author: string; body: string; files: { status: string; path: string }[]
}
export interface UpdateState {
  checked_at?: number; error?: string | null
  current?: CommitInfo | null; branch?: string | null; upstream?: string | null
  behind?: number; ahead?: number; commits?: PendingCommit[]; diffstat?: string; dirty?: string[]
  running: boolean
  last_run: { log: string[]; result: 'ok' | 'failed' | null; changed_at: number } | null
}

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

export const api = {
  getConfig: () => request<Config>('GET', '/config'),
  putConfig: (config: Config) => request<Config>('PUT', '/config', config),
  getSystem: () => request<SystemInfo>('GET', '/system'),
  getStatus: () => request<Status>('GET', '/status'),
  satdump: (action: 'start' | 'stop' | 'restart') => request<SatdumpProcess>('POST', `/satdump/${action}`),
  getSatdumpConfig: () => request<unknown>('GET', '/satdump/config'),
  getLogs: (after: number) => request<{ lines: LogLine[]; last: number }>('GET', `/logs?after=${after}`),
  testReceiver: (sdr: Sdr) => request<ReceiverTest>('POST', '/receiver/test', sdr),
  getNetworks: () => request<NetworksState>('GET', '/networks'),
  scanNetworks: () => request<{ networks: NearbyNetwork[] }>('GET', '/networks/scan'),
  saveNetwork: (n: NewNetwork) => request<{ result: 'added' | 'updated' }>('POST', '/networks', n),
  setNetworkPriority: (uuid: string, priority: number) =>
    request<{ uuid: string }>('PATCH', `/networks/${encodeURIComponent(uuid)}`, { priority }),
  forgetNetwork: (uuid: string) => request<{ forgotten: string }>('DELETE', `/networks/${encodeURIComponent(uuid)}`),
  power: (action: 'restart-app' | 'reboot' | 'poweroff') => request<{ action: string }>('POST', `/system/${action}`),
  getUpdate: () => request<UpdateState>('GET', '/update'),
  checkUpdate: () => request<UpdateState>('POST', '/update/check'),
  applyUpdate: () => request<UpdateState>('POST', '/update/apply'),
  getSchedule: () => request<Schedule>('GET', '/schedule'),
  getLive: (after: number) => request<Live>('GET', `/live?after=${after}`),
  getPasses: () => request<PassList>('GET', '/passes'),
  getPass: (id: string) => request<PassDetail>('GET', `/passes/${encodeURIComponent(id)}`),
  deletePass: (id: string) => request<{ deleted: string }>('DELETE', `/passes/${encodeURIComponent(id)}`),
}

// image paths contain spaces and brackets: encode each part, keep the slashes
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** thumb: small preview; large: screen-sized JPEG; file: SatDump's original file */
export const passFile = (id: string, kind: 'thumb' | 'large' | 'file', path: string) =>
  `/api/passes/${encodeURIComponent(id)}/${kind}/${encodePath(path)}`

export const satdumpImage = (name: 'polarplot' | 'schedule' | 'fft', tick: number) =>
  `/api/satdump/${name}.jpeg?t=${tick}`
