import { useEffect, useState } from 'react'

/** Whether this tab is on screen; a hidden tab doesn't need the live data. */
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
