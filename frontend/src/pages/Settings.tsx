import { useEffect, useState } from 'react'
import { api, ApiError, type Config, type Satellite } from '../api'
import { CheckField, NumberField, TextField } from '../fields'

type Section = keyof Omit<Config, 'satellites'>

const newSatellite = (): Satellite => ({
  name: '', norad: NaN, frequency_hz: 137_900_000, pipeline: 'meteor_m2-x_lrpt', min_elevation: 15, enabled: true,
})

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null)
  const [saved, setSaved] = useState('')       // JSON of the last loaded/saved config, to spot unsaved edits
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getConfig().then(c => { setConfig(c); setSaved(JSON.stringify(c)) },
      e => setErrors([String(e.message)]))
  }, [])

  if (!config) return <section><h2>Settings</h2>{errors.map(e => <p key={e} className="error">{e}</p>)}</section>

  const dirty = JSON.stringify(config) !== saved

  // set one field of one section: set('station', 'lat', 12.3)
  function set<S extends Section, K extends keyof Config[S]>(section: S, key: K, value: Config[S][K]) {
    setConfig(c => c && { ...c, [section]: { ...c[section], [key]: value } })
  }
  function setSat<K extends keyof Satellite>(i: number, key: K, value: Satellite[K]) {
    setConfig(c => c && { ...c, satellites: c.satellites.map((s, j) => j === i ? { ...s, [key]: value } : s) })
  }

  async function save() {
    if (!config) return
    setBusy(true); setErrors([]); setMessage('')
    try {
      const c = await api.putConfig(config)
      setConfig(c); setSaved(JSON.stringify(c))
      setMessage('Saved. SatDump restarts with these settings once no pass is running.')
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [String(e)])
    } finally {
      setBusy(false)
    }
  }

  const { station, sdr, tracking, rotator, discord, storage } = config

  return (
    <div className="settings">
      <div className="savebar">
        <button className="primary" disabled={!dirty || busy} onClick={save}>Save</button>
        <button disabled={!dirty || busy} onClick={() => { setConfig(JSON.parse(saved)); setErrors([]) }}>Discard changes</button>
        {message && !dirty && <span className="ok">{message}</span>}
        {dirty && <span className="hint">Unsaved changes</span>}
      </div>
      {errors.length > 0 && <ul className="error">{errors.map(e => <li key={e}>{e}</li>)}</ul>}

      <section>
        <h2>Station</h2>
        <div className="grid">
          <TextField label="Name" value={station.name} onChange={v => set('station', 'name', v)} />
          <NumberField label="Latitude" hint="degrees, south negative" value={station.lat} onChange={v => set('station', 'lat', v)} />
          <NumberField label="Longitude" hint="degrees, west negative" value={station.lon} onChange={v => set('station', 'lon', v)} />
          <NumberField label="Altitude" hint="meters" value={station.alt} onChange={v => set('station', 'alt', v)} />
        </div>
      </section>

      <section>
        <h2>Receiver</h2>
        <div className="grid">
          <TextField label="Source" hint="SatDump source type" value={sdr.source} onChange={v => set('sdr', 'source', v)} />
          <TextField label="Device id" hint="empty = first one found" value={sdr.source_id} onChange={v => set('sdr', 'source_id', v)} />
          <NumberField label="Sample rate" hint="samples/s" step="1" value={sdr.samplerate} onChange={v => set('sdr', 'samplerate', v)} />
          <NumberField label="Gain" hint="dB" value={sdr.gain} onChange={v => set('sdr', 'gain', v)} />
          <NumberField label="PPM correction" step="1" value={sdr.ppm_correction} onChange={v => set('sdr', 'ppm_correction', v)} />
          <CheckField label="AGC" value={sdr.agc} onChange={v => set('sdr', 'agc', v)} />
          <CheckField label="Bias-tee" hint="powers an LNA through the coax" value={sdr.bias} onChange={v => set('sdr', 'bias', v)} />
        </div>
      </section>

      <section>
        <h2>Satellites</h2>
        <table className="sats">
          <thead>
            <tr><th>On</th><th>Name</th><th>NORAD</th><th>Frequency (Hz)</th><th>Pipeline</th><th>Min el.</th><th></th></tr>
          </thead>
          <tbody>
            {config.satellites.map((s, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={s.enabled} onChange={e => setSat(i, 'enabled', e.target.checked)} /></td>
                <td><input type="text" value={s.name} onChange={e => setSat(i, 'name', e.target.value)} /></td>
                <td><input type="number" value={Number.isNaN(s.norad) ? '' : s.norad}
                  onChange={e => setSat(i, 'norad', e.target.value === '' ? NaN : Number(e.target.value))} /></td>
                <td><input type="number" value={Number.isNaN(s.frequency_hz) ? '' : s.frequency_hz}
                  onChange={e => setSat(i, 'frequency_hz', e.target.value === '' ? NaN : Number(e.target.value))} /></td>
                <td><input type="text" value={s.pipeline} onChange={e => setSat(i, 'pipeline', e.target.value)} /></td>
                <td><input type="number" value={Number.isNaN(s.min_elevation) ? '' : s.min_elevation}
                  onChange={e => setSat(i, 'min_elevation', e.target.value === '' ? NaN : Number(e.target.value))} /></td>
                <td><button onClick={() => setConfig({ ...config, satellites: config.satellites.filter((_, j) => j !== i) })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setConfig({ ...config, satellites: [...config.satellites, newSatellite()] })}>Add satellite</button>
      </section>

      <section>
        <h2>Tracking</h2>
        <div className="grid">
          <NumberField label="Minimum elevation" hint="degrees, for all satellites" value={tracking.min_elevation}
            onChange={v => set('tracking', 'min_elevation', v)} />
          <CheckField label="Stop SDR between passes" value={tracking.stop_sdr_when_idle}
            onChange={v => set('tracking', 'stop_sdr_when_idle', v)} />
        </div>
      </section>

      <section>
        <h2>Rotator</h2>
        <div className="grid">
          <CheckField label="Use a rotator" value={rotator.enabled} onChange={v => set('rotator', 'enabled', v)} />
          <TextField label="Address" hint="rotctld or the Arduino rotator" value={rotator.address} onChange={v => set('rotator', 'address', v)} />
          <NumberField label="Port" step="1" value={rotator.port} onChange={v => set('rotator', 'port', v)} />
        </div>
      </section>

      <section>
        <h2>Discord</h2>
        <div className="grid">
          <CheckField label="Post passes to Discord" value={discord.enabled} onChange={v => set('discord', 'enabled', v)} />
          <TextField label="Webhook URL" placeholder="https://discord.com/api/webhooks/..." value={discord.webhook_url}
            onChange={v => set('discord', 'webhook_url', v)} />
          <TextField label="Images to post" hint="comma separated; empty = default. Picked from real passes in step 4"
            value={discord.composites.join(', ')}
            onChange={v => set('discord', 'composites', v.split(',').map(s => s.trim()).filter(Boolean))} />
          <CheckField label="Also post passes without images" value={discord.post_failed} onChange={v => set('discord', 'post_failed', v)} />
        </div>
      </section>

      <section>
        <h2>Storage</h2>
        <div className="grid">
          <NumberField label="Keep passes for" hint="days" step="1" value={storage.keep_days} onChange={v => set('storage', 'keep_days', v)} />
          <NumberField label="Use at most" hint="GB for passes" value={storage.max_gb} onChange={v => set('storage', 'max_gb', v)} />
          <CheckField label="Keep raw recordings" hint="about 1-2 GB per pass" value={storage.keep_baseband}
            onChange={v => set('storage', 'keep_baseband', v)} />
        </div>
      </section>
    </div>
  )
}
