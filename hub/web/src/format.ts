// Dates in the viewer's time zone, on a 24-hour clock, as on the stations.

const LOCALE = 'en-GB'

export const longDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short', hour12: false })

export const utc = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

/** "13:10" */
export const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })

/** "14 min 03 s", as on the Pi */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (d > 0) return `${d} d ${String(h).padStart(2, '0')} h`
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(r).padStart(2, '0')} s`
  return `${r} s`
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compass = (az: number) => COMPASS[Math.round(az / 45) % 8]

export const percent = (share: number) => Math.round(share * 100) + '%'

/** "Today", "Yesterday", "Wednesday 14 October" (with the year when it isn't this one) */
export function dayLabel(unix: number): string {
  const d = new Date(unix * 1000)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(LOCALE, {
    weekday: 'long', day: 'numeric', month: 'long',
    ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  })
}

/** "3 min ago", "2 h ago", "5 d ago" */
export function ago(unix: number | null): string {
  if (!unix) return 'never'
  const s = Date.now() / 1000 - unix
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** the colour of a highest elevation, as on the stations (30° good, 60° excellent) */
export const elevationQuality = (el: number) => (el >= 60 ? 'excellent' : el >= 30 ? 'good' : 'fair')
