import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, passFile, type PassSignalThumb, type PassSummary } from '../api'
import { usePolling } from '../hooks'
import { clock, longDate, longDay, percent, sameDay, size } from '../format'
import DiscordIcon from '../DiscordIcon'
import SignalChart from '../SignalChart'
import { useT } from '../i18n'
import { elevationQuality } from '../UpcomingPasses'

type Layout = 'grid' | 'list'
const LAYOUT = 'rsat-passes-layout'         // this browser's choice

function storedLayout(): Layout {
  try { return localStorage.getItem(LAYOUT) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

export default function Passes() {
  const t = useT()
  const { data, error } = usePolling(api.getPasses, 15000)
  const [layout, setLayoutState] = useState<Layout>(storedLayout)

  function setLayout(next: Layout) {
    setLayoutState(next)
    try { localStorage.setItem(LAYOUT, next) } catch { /* private mode */ }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {data && data.in_progress.length > 0 && (
        <section>
          <h2>{t('passes.inProgress')}</h2>
          {data.in_progress.map(p => (
            <p key={p.id} className="hint">{t('passes.inProgressItem', { id: p.id })}</p>
          ))}
        </section>
      )}
      {data && data.passes.length === 0 && (
        <section>
          <h2>{t('passes.title')}</h2>
          <p className="hint">{t('passes.none')}</p>
        </section>
      )}
      {data && data.passes.length > 0 && (
        <>
          <div className="title-row">
            <span className="hint">{t('passes.count', { n: data.passes.length })}</span>
            <div className="chips layout-switch">
              {(['grid', 'list'] as const).map(l => (
                <button key={l} className={layout === l ? 'chip on' : 'chip'} onClick={() => setLayout(l)}>
                  {t(l === 'grid' ? 'passes.grid' : 'passes.list')}
                </button>
              ))}
            </div>
          </div>
          {layout === 'grid'
            ? <div className="gallery">{data.passes.map(p => <PassCard key={p.id} pass={p} />)}</div>
            : <PassList passes={data.passes} />}
        </>
      )}
    </>
  )
}

// the satellite name is the card's link, stretched over the whole card (CSS), so the Discord link
// can sit on top of it: a link inside a link is not allowed
function PassCard({ pass }: { pass: PassSummary }) {
  const t = useT()
  return (
    <div className="card pass-card">
      {pass.main
        ? <img src={passFile(pass.id, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">{t('passes.noImages')}</div>}
      <div className="caption">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}><b>{pass.satellite}</b></Link>
          <DiscordLink pass={pass} />
        </div>
        <span>{longDate(pass.time)}</span>
        <SignalLine pass={pass} />
        <ImagesLine pass={pass} />
      </div>
    </div>
  )
}

/** Rows grouped under a heading per day, like the upcoming passes; newest first. */
function PassList({ passes }: { passes: PassSummary[] }) {
  const t = useT()
  const now = Date.now() / 1000
  const label = (time: number) =>
    sameDay(time, now) ? t('up.today') : sameDay(time, now - 86400) ? t('passes.yesterday') : longDay(time)

  const items: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    if (label(p.time) !== day) {
      day = label(p.time)
      items.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    items.push(<PassRow key={p.id} pass={p} />)
  }
  return <div className="pass-list">{items}</div>
}

/** One line per pass: a small image, then the same facts as the card, plus where frames synced. */
function PassRow({ pass }: { pass: PassSummary }) {
  return (
    <div className="pass-row">
      {pass.main
        ? <img src={passFile(pass.id, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage" />}
      <div className="pass-row-text">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}>
            <b>{pass.satellite}</b> <span className="hint">{clock(pass.time)}</span>
          </Link>
        </div>
        <SignalLine pass={pass} withSync />
        <ImagesLine pass={pass} />
      </div>
      <RowChart id={pass.id} />
      <div className="pass-row-discord"><DiscordLink pass={pass} /></div>
    </div>
  )
}

/** The pass's signal chart, bare; loaded once, when the row comes into view. Empty for passes without one. */
function RowChart({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<PassSignalThumb | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        observer.disconnect()
        api.getPassSignal(id).then(setData, () => {})
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [id])
  return (
    <div ref={box} className="pass-row-chart">
      {data && data.samples.length > 0 && data.start !== null && data.end !== null && (
        <SignalChart samples={data.samples} start={data.start} end={data.end} track={data.track ?? undefined} bare />
      )}
    </div>
  )
}

function DiscordLink({ pass }: { pass: PassSummary }) {
  const t = useT()
  if (!pass.discord_url) return null
  return (
    <a className="discord-link" href={pass.discord_url} target="_blank" rel="noreferrer"
      title={t('passes.onDiscord')} aria-label={t('passes.onDiscord')}>
      <DiscordIcon size={18} />
    </a>
  )
}

function SignalLine({ pass, withSync = false }: { pass: PassSummary; withSync?: boolean }) {
  const t = useT()
  if (pass.max_el == null && pass.peak_snr == null) return null
  const first = pass.first_sync?.el, last = pass.last_sync?.el
  return (
    <span>
      {pass.max_el != null && (
        <span className={`el q-${elevationQuality(pass.max_el)}`}>{t('passes.maxEl', { el: Math.round(pass.max_el) })}</span>
      )}
      {pass.max_el != null && pass.peak_snr != null && ' · '}
      {pass.peak_snr != null && t('passes.snr', { snr: pass.peak_snr.toFixed(1) })}
      {pass.locked != null && <> · {t('passes.locked', { p: percent(pass.locked) })}</>}
      {withSync && first != null && last != null && (
        <> · {t('passes.syncEls', { first: Math.round(first), last: Math.round(last) })}</>
      )}
    </span>
  )
}

function ImagesLine({ pass }: { pass: PassSummary }) {
  const t = useT()
  return (
    <span className="hint">
      {pass.coverage !== null && <>{t('passes.received', { p: percent(pass.coverage) })} · </>}
      {t('passes.images', { n: pass.image_count })} · {size(pass.size)}
    </span>
  )
}
