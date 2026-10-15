import { useEffect, useState } from 'react'
import { api, ApiError, type Config, type Satellite, type Station } from '../api'
import { CheckField, NumberField, SelectField, TextField } from '../fields'
import { LANGUAGES, useLanguage, useT } from '../i18n'
import DangerZone from '../DangerZone'
import ReceiverTest from '../ReceiverTest'

type Section = keyof Omit<Config, 'satellites' | 'stations' | 'active_station'>

// number inputs in tables: an emptied box becomes NaN, which the backend rejects with a readable error
const numValue = (v: number) => Number.isNaN(v) ? '' : v
const toNum = (s: string) => s === '' ? NaN : Number(s)

const newSatellite = (): Satellite => ({
  name: '', norad: NaN, frequency_hz: 137_900_000, pipeline: 'meteor_m2-x_lrpt', min_elevation: 15, enabled: true,
})

export default function Settings() {
  const t = useT()
  const { setLang } = useLanguage()
  const [config, setConfig] = useState<Config | null>(null)
  const [saved, setSaved] = useState('')       // JSON of the last loaded/saved config, to spot unsaved edits
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getConfig().then(c => { setConfig(c); setSaved(JSON.stringify(c)) },
      e => setErrors([String(e.message)]))
  }, [])

  if (!config) return <section><h2>{t('settings.title')}</h2>{errors.map(e => <p key={e} className="error">{e}</p>)}</section>

  const dirty = JSON.stringify(config) !== saved

  // set one field of one section: set('sdr', 'gain', 30)
  function set<S extends Section, K extends keyof Config[S]>(section: S, key: K, value: Config[S][K]) {
    setConfig(c => c && { ...c, [section]: { ...c[section], [key]: value } })
  }
  function setSat<K extends keyof Satellite>(i: number, key: K, value: Satellite[K]) {
    setConfig(c => c && { ...c, satellites: c.satellites.map((s, j) => j === i ? { ...s, [key]: value } : s) })
  }
  function setStation<K extends keyof Station>(i: number, key: K, value: Station[K]) {
    setConfig(c => c && { ...c, stations: c.stations.map((s, j) => j === i ? { ...s, [key]: value } : s) })
  }
  function addStation() {
    setConfig(c => c && {
      ...c,
      stations: [...c.stations, { name: t('settings.newStation', { n: c.stations.length + 1 }), lat: 0, lon: 0, alt: 0 }],
    })
  }
  function removeStation(i: number) {
    // keep the selection on the same station; removing the selected one selects the first
    setConfig(c => c && {
      ...c,
      stations: c.stations.filter((_, j) => j !== i),
      active_station: i < c.active_station ? c.active_station - 1 : i === c.active_station ? 0 : c.active_station,
    })
  }

  async function save() {
    if (!config) return
    setBusy(true); setErrors([]); setMessage('')
    try {
      const c = await api.putConfig(config)
      setConfig(c); setSaved(JSON.stringify(c))
      setLang(c.display.language)
      setMessage('settings.saved')
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [String(e)])
    } finally {
      setBusy(false)
    }
  }

  const { sdr, tracking, rotator, discord, storage, display } = config

  return (
    <div className="settings">
      <div className="savebar">
        <button className="primary" disabled={!dirty || busy} onClick={save}>{t('settings.save')}</button>
        <button disabled={!dirty || busy} onClick={() => { setConfig(JSON.parse(saved)); setErrors([]) }}>{t('settings.discard')}</button>
        {message && !dirty && <span className="ok">{t('settings.saved')}</span>}
        {dirty && <span className="hint">{t('settings.unsaved')}</span>}
      </div>
      {errors.length > 0 && <ul className="error">{errors.map(e => <li key={e}>{e}</li>)}</ul>}

      <section>
        <h2>{t('settings.stations')}</h2>
        <table className="sats">
          <thead>
            <tr>
              <th>{t('settings.use')}</th><th>{t('settings.name')}</th><th>{t('settings.latitude')}</th>
              <th>{t('settings.longitude')}</th><th>{t('settings.altitude')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {config.stations.map((st, i) => (
              <tr key={i} className={i === config.active_station ? 'selected' : undefined}>
                <td><input type="radio" name="active-station" checked={i === config.active_station}
                  onChange={() => setConfig({ ...config, active_station: i })} /></td>
                <td><input type="text" value={st.name} onChange={e => setStation(i, 'name', e.target.value)} /></td>
                <td><input type="number" step="any" value={numValue(st.lat)} onChange={e => setStation(i, 'lat', toNum(e.target.value))} /></td>
                <td><input type="number" step="any" value={numValue(st.lon)} onChange={e => setStation(i, 'lon', toNum(e.target.value))} /></td>
                <td><input type="number" step="any" value={numValue(st.alt)} onChange={e => setStation(i, 'alt', toNum(e.target.value))} /></td>
                <td><button disabled={config.stations.length === 1} onClick={() => removeStation(i)}>{t('common.remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button onClick={addStation}>{t('settings.addStation')}</button>
          <span className="hint">{t('settings.stationsHint')}</span>
        </div>
      </section>

      <section>
        <h2>{t('settings.receiver')}</h2>
        <div className="grid">
          <TextField label={t('settings.source')} hint={t('settings.sourceHint')} value={sdr.source} onChange={v => set('sdr', 'source', v)} />
          <TextField label={t('settings.deviceId')} hint={t('settings.deviceHint')} value={sdr.source_id} onChange={v => set('sdr', 'source_id', v)} />
          <NumberField label={t('settings.sampleRate')} hint={t('settings.samplesPerSecond')} step="1" value={sdr.samplerate} onChange={v => set('sdr', 'samplerate', v)} />
          <NumberField label={t('settings.gain')} hint="dB" value={sdr.gain} onChange={v => set('sdr', 'gain', v)} />
          <NumberField label={t('settings.ppm')} step="1" value={sdr.ppm_correction} onChange={v => set('sdr', 'ppm_correction', v)} />
          <CheckField label={t('settings.agc')} value={sdr.agc} onChange={v => set('sdr', 'agc', v)} />
          <CheckField label={t('settings.bias')} hint={t('settings.biasHint')} value={sdr.bias} onChange={v => set('sdr', 'bias', v)} />
        </div>
        <ReceiverTest sdr={sdr} />
      </section>

      <section>
        <h2>{t('settings.satellites')}</h2>
        <table className="sats">
          <thead>
            <tr>
              <th>{t('settings.on')}</th><th>{t('settings.name')}</th><th>NORAD</th><th>{t('settings.frequency')}</th>
              <th>{t('settings.pipeline')}</th><th>{t('settings.minEl')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {config.satellites.map((s, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={s.enabled} onChange={e => setSat(i, 'enabled', e.target.checked)} /></td>
                <td><input type="text" value={s.name} onChange={e => setSat(i, 'name', e.target.value)} /></td>
                <td><input type="number" value={numValue(s.norad)} onChange={e => setSat(i, 'norad', toNum(e.target.value))} /></td>
                <td><input type="number" value={numValue(s.frequency_hz)} onChange={e => setSat(i, 'frequency_hz', toNum(e.target.value))} /></td>
                <td><input type="text" value={s.pipeline} onChange={e => setSat(i, 'pipeline', e.target.value)} /></td>
                <td><input type="number" value={numValue(s.min_elevation)} onChange={e => setSat(i, 'min_elevation', toNum(e.target.value))} /></td>
                <td><button onClick={() => setConfig({ ...config, satellites: config.satellites.filter((_, j) => j !== i) })}>{t('common.remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setConfig({ ...config, satellites: [...config.satellites, newSatellite()] })}>{t('settings.addSatellite')}</button>
      </section>

      <section>
        <h2>{t('settings.tracking')}</h2>
        <div className="grid">
          <NumberField label={t('settings.minElevation')} hint={t('settings.minElevationHint')} value={tracking.min_elevation}
            onChange={v => set('tracking', 'min_elevation', v)} />
          <CheckField label={t('settings.stopSdr')} value={tracking.stop_sdr_when_idle}
            onChange={v => set('tracking', 'stop_sdr_when_idle', v)} />
        </div>
      </section>

      <section>
        <h2>{t('settings.rotator')}</h2>
        <div className="grid">
          <CheckField label={t('settings.useRotator')} value={rotator.enabled} onChange={v => set('rotator', 'enabled', v)} />
          <TextField label={t('settings.address')} hint={t('settings.addressHint')} value={rotator.address} onChange={v => set('rotator', 'address', v)} />
          <NumberField label={t('settings.port')} step="1" value={rotator.port} onChange={v => set('rotator', 'port', v)} />
        </div>
      </section>

      <section>
        <h2>{t('settings.discord')}</h2>
        <div className="grid">
          <CheckField label={t('settings.post')} value={discord.enabled} onChange={v => set('discord', 'enabled', v)} />
          <TextField label={t('settings.webhook')} placeholder="https://discord.com/api/webhooks/..." value={discord.webhook_url}
            onChange={v => set('discord', 'webhook_url', v)} />
          <TextField label={t('settings.images')} hint={t('settings.imagesHint')}
            value={discord.composites.join(', ')}
            onChange={v => set('discord', 'composites', v.split(',').map(s => s.trim()).filter(Boolean))} />
          <CheckField label={t('settings.postFailed')} value={discord.post_failed} onChange={v => set('discord', 'post_failed', v)} />
        </div>
      </section>

      <section>
        <h2>{t('settings.storage')}</h2>
        <div className="grid">
          <NumberField label={t('settings.keepDays')} hint={t('settings.days')} step="1" value={storage.keep_days} onChange={v => set('storage', 'keep_days', v)} />
          <NumberField label={t('settings.maxGb')} hint={t('settings.maxGbHint')} value={storage.max_gb} onChange={v => set('storage', 'max_gb', v)} />
          <CheckField label={t('settings.keepRaw')} hint={t('settings.keepRawHint')} value={storage.keep_baseband}
            onChange={v => set('storage', 'keep_baseband', v)} />
        </div>
      </section>

      <section>
        <h2>{t('settings.display')}</h2>
        <div className="grid">
          <SelectField label={t('settings.language')} value={display.language}
            options={LANGUAGES.map(l => ({ value: l.code, label: l.name }))}
            onChange={v => set('display', 'language', v)} />
          <NumberField label={t('settings.upcomingDays')} hint={t('settings.upcomingDaysHint')} step="1"
            value={display.upcoming_days} onChange={v => set('display', 'upcoming_days', v)} />
          <CheckField label={t('settings.showLow')} hint={t('settings.showLowHint')}
            value={display.show_low_passes} onChange={v => set('display', 'show_low_passes', v)} />
        </div>
        <p className="hint">{t('settings.displayHint')}</p>
      </section>

      <DangerZone />
    </div>
  )
}
