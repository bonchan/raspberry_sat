// This browser's own choices (language, layouts, switches), kept across visits. Keys start with
// "raspberry-sat-"; a choice saved under the older "rsat-" name is still read, and moves over when saved again.

const PREFIX = 'raspberry-sat-'
const OLD_PREFIX = 'rsat-'

/** The saved value, or null: nothing saved, or the browser doesn't allow storage (private mode). */
export function stored(name: string): string | null {
  try {
    return localStorage.getItem(PREFIX + name) ?? localStorage.getItem(OLD_PREFIX + name)
  } catch {
    return null
  }
}

export function store(name: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + name, value)
    localStorage.removeItem(OLD_PREFIX + name)
  } catch { /* private mode */ }
}
