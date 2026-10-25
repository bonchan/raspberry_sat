import { useState } from 'react'
import { api, ApiError, type Destination, type DiscordMode } from './api'
import { CheckField, ListField, SelectField, TextField } from './fields'
import { useT } from './i18n'

const errorText = (e: unknown) => e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e)

/** Settings → Destinations: websites that collect passes from several stations, such as the raspberry-sat
    hub (backend/app/destinations.py). `dirty`: the page has unsaved changes. */
export default function Destinations({ list, dirty, onChange }:
  { list: Destination[]; dirty: boolean; onChange: (list: Destination[]) => void }) {
  const t = useT()

  function add() {
    const taken = new Set(list.map(d => d.name.toLowerCase()))
    let name = 'hub', n = 2
    while (taken.has(name)) name = `hub ${n++}`
    onChange([...list, {
      name, url: '', token: '', mode: 'off', images: [], full_size: false, delete_after_upload: false, since: 0,
    }])
  }

  return (
    <section>
      <h2>{t('settings.destinations')}</h2>
      <p className="hint">{t('settings.destinationsHint')}</p>
      {list.map((d, i) => (
        <DestinationForm key={i} d={d} dirty={dirty}
          onChange={patch => onChange(list.map((x, j) => j === i ? { ...x, ...patch } : x))}
          onRemove={() => onChange(list.filter((_, j) => j !== i))} />
      ))}
      <button onClick={add}>{t('settings.addDestination')}</button>
    </section>
  )
}

function DestinationForm({ d, dirty, onChange, onRemove }:
  { d: Destination; dirty: boolean; onChange: (patch: Partial<Destination>) => void; onRemove: () => void }) {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function test() {
    setTesting(true); setResult(null)
    try {
      const r = await api.testDestination(d)
      setResult({ ok: true, text: t('settings.destTestOk', { name: (r.receiver ?? r.station)?.name ?? '?' }) })
    } catch (e) {
      setResult({ ok: false, text: errorText(e) })
    } finally {
      setTesting(false)
    }
  }

  async function older() {
    setResult(null)
    try {
      setResult({ ok: true, text: t('settings.destOlderDone', { n: (await api.sendOlder(d.name)).queued }) })
    } catch (e) {
      setResult({ ok: false, text: errorText(e) })
    }
  }

  const modes: { value: DiscordMode; label: string }[] = [
    { value: 'off', label: t('settings.destOff') },
    { value: 'auto', label: t('settings.destAuto') },
    { value: 'manual', label: t('settings.destManual') },
  ]
  return (
    <div className="destination">
      <div className="grid">
        <TextField label={t('settings.name')} value={d.name} onChange={v => onChange({ name: v })} />
        <TextField label={t('settings.destUrl')} hint={t('settings.destUrlHint')} value={d.url}
          placeholder="https://…/ingest" onChange={v => onChange({ url: v })} />
        <TextField label={t('settings.destToken')} hint={t('settings.destTokenHint')} value={d.token} secret
          onChange={v => onChange({ token: v })} />
        <SelectField label={t('settings.destMode')} value={d.mode} options={modes} onChange={v => onChange({ mode: v })} />
        <ListField label={t('settings.destImages')} hint={t('settings.destImagesHint')} value={d.images}
          onChange={v => onChange({ images: v })} />
        <CheckField label={t('settings.destFullSize')} hint={t('settings.destFullSizeHint')} value={d.full_size}
          onChange={v => onChange({ full_size: v })} />
        <CheckField label={t('settings.destDelete')} hint={t('settings.destDeleteHint')} value={d.delete_after_upload}
          onChange={v => onChange({ delete_after_upload: v })} />
      </div>
      {d.delete_after_upload && <p className="caution">{t('settings.destDeleteWarn', { name: d.name })}</p>}
      <div className="row">
        <button disabled={testing || !d.url || !d.token} onClick={test}>
          {testing ? t('settings.destTesting') : t('settings.destTest')}
        </button>
        {/* works on the saved settings: the destination must be saved as automatic */}
        <button disabled={dirty || d.mode !== 'auto'} title={dirty ? t('settings.destSaveFirst') : undefined} onClick={older}>
          {t('settings.destOlder')}
        </button>
        <button onClick={onRemove}>{t('common.remove')}</button>
      </div>
      <p className="hint">{t('settings.destOlderHint')}</p>
      {result && <p className={result.ok ? 'ok' : 'error'}>{result.text}</p>}
    </div>
  )
}
