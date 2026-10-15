import { currentLanguage, locale } from './i18n'

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(r).padStart(2, '0')} s`
  return `${r} s`
}

// local times, in the interface language (always 24-hour)
export const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false })

export const clockSeconds = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString(locale(), { hour12: false })

export const dateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export const longDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short', hour12: false })

/** "Wednesday 14" / "miércoles 14" */
export const weekdayAndDay = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${d.toLocaleDateString(locale(), { weekday: 'long' })} ${d.getDate()}`
}

export const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + ' GB'

export function size(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' kB'
  return bytes + ' B'
}

export const percent = (share: number) => Math.round(share * 100) + '%'

/** "13:10" in UTC */
export const utcClock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 16)

export const utc = (unix: number) =>
  new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

const COMPASS = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
}
export const compass = (az: number) => COMPASS[currentLanguage()][Math.round(az / 45) % 8]
