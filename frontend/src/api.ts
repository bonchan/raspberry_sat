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

export interface Config {
  station: Station; sdr: Sdr; satellites: Satellite[]; tracking: Tracking
  rotator: Rotator; discord: Discord; storage: Storage
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
  satdump: SatdumpProcess; tracker: SatdumpApi | null; tracker_age: number | null; in_pass: boolean
}
export interface LogLine { seq: number; time: number; level: string; source: string; text: string }

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
}

export const satdumpImage = (name: 'polarplot' | 'schedule' | 'fft', tick: number) =>
  `/api/satdump/${name}.jpeg?t=${tick}`
