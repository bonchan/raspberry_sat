import { useEffect, useRef, useState } from 'react'

/** Calls `fn` now and every `ms` after the previous call finished; not at all while `enabled` is false. */
export function usePolling<T>(fn: () => Promise<T>, ms: number, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let timer: number | undefined
    async function tick() {
      try {
        const d = await fnRef.current()
        if (alive) { setData(d); setError('') }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
      if (alive) timer = window.setTimeout(tick, ms)
    }
    tick()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [ms, enabled])

  return { data, error }
}

/** Whether this tab is on screen; hidden tabs need not poll fast. */
export function useVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  return visible
}

/** A number that changes every `ms`, for cache-busting images that SatDump redraws. */
export function useTick(ms: number, enabled = true) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setTick(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms, enabled])
  return tick
}

/** Seconds since the epoch, updated every second, for countdowns. */
export function useNow() {
  return useTick(1000) / 1000
}
