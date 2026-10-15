export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(r).padStart(2, '0')} s`
  return `${r} s`
}

export const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const dateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })

export const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + ' GB'
