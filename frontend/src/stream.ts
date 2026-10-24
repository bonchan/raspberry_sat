// One WebSocket per tab to /api/ws, shared by every page (backend: hub.py). Components subscribe to
// topics; each gets the topic's current state as soon as it subscribes and every change after. The
// socket opens with the first subscription and reconnects by itself (the app restarts during updates),
// subscribing again to what is still wanted.

import { useEffect, useState } from 'react'
import type {
  Config, LiveSample, LiveState, LogLine, PassList, SatdumpProcess, Schedule, Spectrum, Status, SystemInfo, TleSet,
  UpdateState,
} from './api'

/** the live signal: a snapshot first (and after every reconnect), then updates */
export type LiveMessage =
  | ({ kind: 'snapshot'; history: LiveSample[] } & LiveState)
  | ({ kind: 'update'; sample?: LiveSample } & LiveState)

/** the log: everything kept first (and after every reconnect), then each new line */
export interface LogsMessage { kind: 'snapshot' | 'update'; lines: LogLine[]; last: number }

/** what each topic carries (backend: tasks.py and streams.py) */
export interface Topics {
  status: Status
  satdump: SatdumpProcess
  live: LiveMessage
  spectrum: Spectrum | null        // null while SatDump has none
  system: SystemInfo
  update: UpdateState
  logs: LogsMessage
  passes: PassList
  schedule: Schedule
  config: Config
  tles: TleSet
}

export type Connection = 'connecting' | 'up' | 'down'

type Listener = (data: unknown) => void

const listeners = new Map<string, Set<Listener>>()
const latest = new Map<string, unknown>()
const watchers = new Set<(state: Connection) => void>()
let socket: WebSocket | null = null
let retry: number | undefined         // a reconnect is waiting: don't open another socket meanwhile
let state: Connection = 'connecting'
let attempts = 0

function setState(next: Connection) {
  state = next
  watchers.forEach(fn => fn(next))
}

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${scheme}://${location.host}/api/ws`)
  socket = ws
  ws.onopen = () => {
    attempts = 0
    setState('up')
    if (listeners.size) send({ subscribe: [...listeners.keys()] })
  }
  ws.onmessage = event => {
    const { topic, data } = JSON.parse(event.data as string) as { topic: string; data: unknown }
    latest.set(topic, data)
    listeners.get(topic)?.forEach(fn => fn(data))
  }
  ws.onclose = () => {
    socket = null
    setState('down')
    retry = window.setTimeout(() => {           // 0.5 s, 1 s, 2 s... at most 5 s
      retry = undefined
      connect()
    }, Math.min(5000, 500 * 2 ** attempts++))
  }
}

/** Calls `fn` with the topic's data now (when known) and on every change; returns the unsubscribe. */
export function subscribe<K extends keyof Topics>(topic: K, fn: (data: Topics[K]) => void): () => void {
  if (!socket && retry === undefined) connect()
  let set = listeners.get(topic)
  if (!set) {
    set = new Set()
    listeners.set(topic, set)
  }
  const listener = fn as Listener
  set.add(listener)
  send({ subscribe: [topic] })        // the server answers with the current state, for every listener
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      listeners.delete(topic)
      latest.delete(topic)
      send({ unsubscribe: [topic] })
    }
  }
}

/** The topic's latest data, kept up to date; undefined until the first message. Not subscribed while
    `enabled` is false. */
export function useTopic<K extends keyof Topics>(topic: K, enabled = true): Topics[K] | undefined {
  const [data, setData] = useState<Topics[K] | undefined>(() => latest.get(topic) as Topics[K] | undefined)
  useEffect(() => (enabled ? subscribe(topic, setData) : undefined), [topic, enabled])
  return data
}

/** Whether the connection to the Pi is up: 'down' after it closed, until it opens again. */
export function useConnection(): Connection {
  const [current, setCurrent] = useState(state)
  useEffect(() => {
    watchers.add(setCurrent)
    return () => { watchers.delete(setCurrent) }
  }, [])
  return current
}
