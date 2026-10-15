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
}
