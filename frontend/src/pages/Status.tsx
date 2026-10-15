import { useEffect, useState } from 'react'
import { api, type SystemInfo } from '../api'

const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + ' GB'

export default function Status() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getSystem().then(setInfo, e => setError(String(e.message)))
  }, [])

  return (
    <section>
      <h2>System</h2>
      {error && <p className="error">{error}</p>}
      {info && (
        <dl className="facts">
          <dt>Host</dt><dd>{info.hostname}</dd>
          <dt>Code</dt><dd>{info.version}</dd>
          <dt>Data</dt><dd>{info.data_dir}</dd>
          <dt>Disk</dt>
          <dd>{gb(info.disk.used)} used, {gb(info.disk.free)} free of {gb(info.disk.total)}</dd>
        </dl>
      )}
      <p className="hint">Live SatDump status (next pass, polar plot, schedule) arrives in build step 2.</p>
    </section>
  )
}
