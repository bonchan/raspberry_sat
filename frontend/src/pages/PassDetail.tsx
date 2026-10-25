import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, ApiError, passFile, type Destination, type DiscordMode, type PassDetail as Pass, type PassDiscord, type PassHub,
  type PassImage,
} from '../api'
import { useConfirm } from '../Dialog'
import DiscordIcon from '../DiscordIcon'
import { clock, compass, duration, longDate, percent, size, utc } from '../format'
import { translate, useLanguage, useT, type Key, type Lang } from '../i18n'
import SignalChart, { syncEnds, syncPlace } from '../SignalChart'
import SkyPlot, { SkyLegend } from '../SkyPlot'
import { elevationQuality } from '../UpcomingPasses'

// which variant of a composite to show first
const VARIANT_ORDER = ['corrected,map', 'corrected', 'map', '']

const KNOWN_VARIANTS = ['corrected', 'map', 'projected']

function variantLabel(lang: Lang, variants: string[]): string {
  if (!variants.length) return translate(lang, 'variant.raw')
  return variants.map(v => KNOWN_VARIANTS.includes(v) ? translate(lang, `variant.${v}` as Key) : v).join(' + ')
}

interface Group { key: string; instrument: string; name: string; images: PassImage[] }

function groupImages(images: PassImage[], main: string | null): Group[] {
  const groups = new Map<string, Group>()
  for (const img of images) {
    const key = `${img.instrument}|${img.name}`
    if (!groups.has(key)) groups.set(key, { key, instrument: img.instrument, name: img.name, images: [] })
    groups.get(key)!.images.push(img)
  }
  const rank = (i: PassImage) => {
    const r = VARIANT_ORDER.indexOf(i.variants.join(','))
    return r < 0 ? VARIANT_ORDER.length : r
  }
  const list = [...groups.values()]
  for (const g of list) g.images.sort((a, b) => rank(a) - rank(b))
  // the main image's composite first, then by name
  const hasMain = (g: Group) => g.images.some(i => i.path === main)
  return list.sort((a, b) =>
    Number(hasMain(b)) - Number(hasMain(a)) || a.name.localeCompare(b.name))
}

export default function PassDetail() {
  const t = useT()
  const ask = useConfirm()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [pass, setPass] = useState<Pass | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<PassImage | null>(null)
  const [discordMode, setDiscordMode] = useState<DiscordMode>('off')
  const [dests, setDests] = useState<Destination[]>([])

  useEffect(() => {
    api.getPass(id).then(setPass, e => setError(String(e.message)))
  }, [id])
  useEffect(() => {
    api.getConfig().then(c => { setDiscordMode(c.discord.mode); setDests(c.destinations ?? []) }, () => {})
  }, [])

  const groups = useMemo(() => pass ? groupImages(pass.images, pass.main) : [], [pass])

  if (error) return <section><p className="error">{error}</p><Link to="/passes">{t('detail.back')}</Link></section>
  if (!pass) return <section><p className="hint">{t('common.loading')}</p></section>

  async function remove() {
    if (!pass) return
    const ok = await ask({ title: t('detail.delete'), message: t('detail.confirmDelete', { size: size(pass.size) }),
                           confirmLabel: t('detail.delete'), danger: true })
    if (!ok) return
    try {
      await api.deletePass(pass.id)
      navigate('/passes')
    } catch (e) {
      setError(String(e))
    }
  }

  const main = pass.images.find(i => i.path === pass.main)
  const { orbit, signal } = pass
  const samples = pass.samples ?? []
  const ends = syncEnds(samples)
  const syncKnown = samples.some(s => s.deframer_lock !== undefined)
  const slim = pass.slimmed
  // where the images deleted from the Pi can still be seen
  const hub = slim?.url ? { name: slim.destination, url: slim.url } : null
  const noteHub = (name: string, note: PassHub) => setPass({ ...pass, hubs: { ...pass.hubs, [name]: note } })

  return (
    <>
      <section>
        <p><Link to="/passes">{t('detail.back')}</Link></p>
        <div className="title-row">
          <h2>{pass.satellite}</h2>
          <div className="title-actions">
            <DiscordButton pass={pass} mode={discordMode} onChange={d => setPass({ ...pass, discord: d })} />
            {dests.map(d => <HubButton key={d.name} pass={pass} dest={d} onChange={noteHub} />)}
          </div>
        </div>
        {slim && (
          <p className="hint">
            {t('detail.slimmed', { time: longDate(slim.at), name: slim.destination })}
            {hub && <> <a href={hub.url} target="_blank" rel="noreferrer">{t('detail.slimmedOpen', { name: hub.name })}</a></>}
          </p>
        )}
        <div className="pass-top">
          <dl className="facts">
            <dt>{t('detail.time')}</dt><dd>{longDate(pass.time)} ({utc(pass.time)})</dd>
            {orbit && <>
              <dt>{t('detail.maxEl')}</dt>
              <dd>
                <span className={`el q-${elevationQuality(orbit.max_el)}`}>{orbit.max_el.toFixed(1)}°</span>{' '}
                {t('detail.at', { time: clock(orbit.tca) })}
              </dd>
              <dt>{t('detail.overSky')}</dt>
              <dd>
                {clock(orbit.aos)} – {clock(orbit.los)} ({duration(orbit.los - orbit.aos)}),{' '}
                {t('detail.direction', { from: compass(orbit.aos_az), to: compass(orbit.los_az) })}
              </dd>
            </>}
            {signal && <>
              {signal.peak_snr != null && signal.mean_snr != null && <>
                <dt>{t('detail.signal')}</dt>
                <dd>{t('detail.signalValue', { peak: signal.peak_snr.toFixed(1), mean: signal.mean_snr.toFixed(1) })}</dd>
              </>}
              {signal.locked !== null && <>
                <dt>{t('detail.locked')}</dt>
                <dd>{t('detail.lockedValue', { p: percent(signal.locked), d: duration(signal.seconds) })}</dd>
              </>}
            </>}
            {pass.coverage !== null && <>
              <dt>{t('detail.received')}</dt><dd>{t('detail.receivedValue', { p: percent(pass.coverage) })}</dd>
            </>}
            {ends && <>
              <dt>{t('detail.firstSync')}</dt><dd>{t('detail.syncAt', syncPlace(ends.first))}</dd>
              <dt>{t('detail.lastSync')}</dt><dd>{t('detail.syncAt', syncPlace(ends.last))}</dd>
            </>}
            {!ends && syncKnown && <><dt>{t('detail.sync')}</dt><dd className="error">{t('sync.none')}</dd></>}
            <dt>{t('detail.images')}</dt><dd>{pass.images.length}</dd>
            <dt>{t('detail.size')}</dt><dd>{size(pass.size)}</dd>
            <dt>{t('detail.folder')}</dt>
            <dd>{pass.id}{pass.source_name !== pass.id && <span className="hint"> {t('detail.was', { name: pass.source_name })}</span>}</dd>
            <DiscordFact pass={pass} mode={discordMode} />
            {dests.map(d => <HubFact key={d.name} pass={pass} dest={d} />)}
          </dl>
          {(orbit || samples.length > 0) && (
            <div>
              <SkyPlot track={orbit?.track} samples={samples} />
              {syncKnown && <SkyLegend now={false} minEl={false} sync />}
            </div>
          )}
        </div>
        {main && (
          <img className="hero" src={passFile(pass.id, 'large', main.path)} alt={main.name}
            onClick={() => setOpen(main)} />
        )}
      </section>

      {groups.length > 0 && (
        <section>
          <h2>{t('detail.images')}</h2>
          <div className="gallery">
            {groups.map(g => <GroupCard key={g.key} passId={pass.id} group={g} onOpen={setOpen} />)}
          </div>
        </section>
      )}

      {pass.samples?.length > 0 && (
        <section>
          <h2>{t('detail.signalChart')}</h2>
          {/* the elevation curve spans AOS to LOS; without an orbit, the samples set the span */}
          <SignalChart samples={pass.samples} track={orbit?.track}
            start={orbit?.aos ?? pass.samples[0].t} end={orbit?.los ?? pass.samples[pass.samples.length - 1].t} />
          {signal?.rebuilt && <p className="hint">{t('detail.rebuilt')}</p>}
        </section>
      )}

      <section>
        <h2>{t('detail.files')}</h2>
        <ul className="files">
          {pass.files.map(f => (
            <li key={f.path}><a href={passFile(pass.id, 'file', f.path)}>{f.path}</a> <span className="hint">{size(f.bytes)}</span></li>
          ))}
        </ul>
        <button className="danger" onClick={remove}>{t('detail.delete')}</button>
      </section>

      {open && <Lightbox passId={pass.id} image={open} hub={hub} onClose={() => setOpen(null)} />}
    </>
  )
}

/** Next to the satellite name: posts the pass. Shows when posting is by hand, or when posting is
 *  automatic and it failed. */
function DiscordButton({ pass, mode, onChange }: { pass: Pass; mode: DiscordMode; onChange: (d: PassDiscord) => void }) {
  const t = useT()
  const ask = useConfirm()
  const [posting, setPosting] = useState(false)
  const d = pass.discord
  if (!(mode === 'manual' || (mode === 'auto' && d?.error))) return null

  async function post() {
    if (d?.posted_at && !(await ask({ title: t('detail.discordPostAgain'), message: t('detail.discordConfirmAgain'),
                                      confirmLabel: t('detail.discordPostAgain') }))) return
    setPosting(true)
    try {
      onChange(await api.postPass(pass.id))
    } catch (e) {
      onChange({ ...d, error: e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e) })
    } finally {
      setPosting(false)
    }
  }

  const label = posting ? t('detail.discordPosting')
    : d?.error ? t('detail.discordRetry')
    : d?.posted_at ? t('detail.discordPostAgain')
    : t('detail.discordPost')
  return (
    <button className="with-icon" disabled={posting} onClick={post}><DiscordIcon />{label}</button>
  )
}

/** Whether and where the pass is on Discord, and why the last try failed. */
function DiscordFact({ pass, mode }: { pass: Pass; mode: DiscordMode }) {
  const t = useT()
  const d = pass.discord
  if (mode === 'off' && !d) return null
  return (
    <>
      <dt>{t('detail.discord')}</dt>
      <dd>
        {d?.posted_at
          ? <>
              {t('detail.discordPosted', { time: longDate(d.posted_at) })}
              {d.channel && <> {t('detail.discordIn', { channel: d.channel })}</>}
              {d.url && <> · <a href={d.url} target="_blank" rel="noreferrer">{t('detail.discordOpen')}</a></>}
            </>
          : t('detail.discordNotPosted')}
        {d?.error && <div className="error">{t('detail.discordFailed', { error: d.error })}</div>}      </dd>
    </>
  )
}

const errorText = (e: unknown) => e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e)

/** Next to the satellite name: sends the pass to a destination (Settings → Destinations). Shows when sending
 *  is by hand, or when it is automatic and the pass isn't there yet (an older pass) or the last try failed. */
function HubButton({ pass, dest, onChange }: { pass: Pass; dest: Destination; onChange: (name: string, note: PassHub) => void }) {
  const t = useT()
  const ask = useConfirm()
  const [sending, setSending] = useState(false)
  const note = pass.hubs?.[dest.name]
  if (dest.mode === 'off' || !(dest.mode === 'manual' || note?.error || !note?.uploaded_at)) return null
  const name = dest.name

  async function send() {
    if (note?.uploaded_at && !note.error && !(await ask({
      title: t('detail.hubSendAgain', { name }), message: t('detail.hubConfirmAgain', { name }),
      confirmLabel: t('detail.hubSendAgain', { name }),
    }))) return
    setSending(true)
    try {
      onChange(name, await api.sendToDestination(pass.id, name))
    } catch (e) {
      onChange(name, { ...note, error: errorText(e) })
    } finally {
      setSending(false)
    }
  }

  const label = sending ? t('detail.hubSending')
    : note?.error ? t('detail.hubRetry', { name })
    : note?.uploaded_at ? t('detail.hubSendAgain', { name })
    : t('detail.hubSend', { name })
  return <button disabled={sending} onClick={send}>{label}</button>
}

/** Whether and where the pass is on a destination, and why the last try failed. */
function HubFact({ pass, dest }: { pass: Pass; dest: Destination }) {
  const t = useT()
  const note = pass.hubs?.[dest.name]
  if (dest.mode === 'off' && !note) return null
  return (
    <>
      <dt>{dest.name}</dt>
      <dd>
        {note?.uploaded_at
          ? <>
              {t('detail.hubSent', { time: longDate(note.uploaded_at), n: note.images ?? 0 })}
              {note.url && <> · <a href={note.url} target="_blank" rel="noreferrer">{t('detail.hubOpen')}</a></>}
            </>
          : t('detail.hubNotSent')}
        {note?.error && (
          <div className="error">
            {t('detail.hubFailed', { error: note.error })}
            {note.next_try && dest.mode === 'auto' && <span className="hint"> · {t('detail.hubNextTry', { time: clock(note.next_try) })}</span>}
          </div>
        )}
      </dd>
    </>
  )
}

function GroupCard({ passId, group, onOpen }: { passId: string; group: Group; onOpen: (i: PassImage) => void }) {
  const t = useT()
  const { lang } = useLanguage()
  const [shown, setShown] = useState(group.images[0])
  return (
    <div className="card">
      {shown.error
        ? <div className="noimage">{t('detail.unreadable')}</div>
        : <img src={passFile(passId, 'thumb', shown.path)} alt={group.name} loading="lazy" onClick={() => onOpen(shown)} />}
      <div className="caption">
        <b>{group.name}</b>
        {group.images.length > 1 && (
          <div className="chips">
            {group.images.map(i => (
              <button key={i.path} className={i === shown ? 'chip on' : 'chip'} onClick={() => setShown(i)}>
                {variantLabel(lang, i.variants)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** An image large. One deleted from the Pi after upload (gone) shows its thumbnail and where it went. */
function Lightbox({ passId, image, hub, onClose }:
  { passId: string; image: PassImage; hub: { name: string; url: string } | null; onClose: () => void }) {
  const t = useT()
  const { lang } = useLanguage()
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={passFile(passId, image.gone ? 'thumb' : 'large', image.path)} alt={image.name} />
      <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
        <span>{image.name} · {variantLabel(lang, image.variants)}</span>
        {image.gone
          ? <span className="hint">
              {t('detail.gone')}
              {hub && <> <a href={hub.url} target="_blank" rel="noreferrer">{t('detail.slimmedOpen', { name: hub.name })}</a></>}
            </span>
          : <a href={passFile(passId, 'file', image.path)} target="_blank" rel="noreferrer">
              {t('detail.original', { w: image.width ?? '?', h: image.height ?? '?', size: size(image.bytes) })}
            </a>}
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  )
}
