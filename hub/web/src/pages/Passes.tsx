import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fileUrl, type PassCard, type ReceiverName, type SignalThumb, type StationName } from '../api'
import { clock, dayLabel, elevationQuality, longDate, percent } from '../format'
import { useT, type Key } from '../i18n'
import PassesGlobe from '../PassesGlobe'
import SignalChart from '../SignalChart'

type Layout = 'grid' | 'list' | 'globe'
const LAYOUTS: { value: Layout; label: Key }[] = [
  { value: 'grid', label: 'passes.grid' }, { value: 'list', label: 'passes.list' }, { value: 'globe', label: 'passes.globe' },
]
const LAYOUT_KEY = 'raspberry-sat-hub-layout'     // this browser's choice

function storedLayout(): Layout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.some(l => l.value === saved) ? saved as Layout : 'grid'
  } catch {
    return 'grid'
  }
}

/** Every receiver's passes, newest first, as a grid, a list (with the signal over each pass) or on a globe,
    as on the Pi. Filters by receiver (Pi) and by station (one of its places) when there is a choice. */
export default function Passes({ admin }: { admin: boolean }) {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const receiver = params.get('receiver') ?? ''
  const station = params.get('station') ?? ''
  const [layout, setLayoutState] = useState<Layout>(storedLayout)
  const [passes, setPasses] = useState<PassCard[]>([])
  const [receivers, setReceivers] = useState<ReceiverName[]>([])
  const [stations, setStations] = useState<StationName[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const query = { receiver: receiver || undefined, station: station || undefined }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    api.passes(query)
      .then(r => {
        if (!alive) return
        setPasses(r.passes)
        setMore(r.more)
        setReceivers(r.receivers)
        setStations(r.stations)
      }, e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [receiver, station])

  function setLayout(next: Layout) {
    setLayoutState(next)
    try { localStorage.setItem(LAYOUT_KEY, next) } catch { /* private mode */ }
  }

  async function older() {
    setLoading(true)
    try {
      const r = await api.passes({ ...query, before: passes[passes.length - 1].time })
      setPasses(p => [...p, ...r.passes])
      setMore(r.more)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const several = receivers.length > 1
  const receiverName = (id: string) => receivers.find(r => r.id === id)?.name ?? id
  // a station's chip names its receiver too when there are several Pis and none is chosen
  const shown = stations.filter(s => !receiver || s.receiver === receiver)
  const chooseReceiver = (id: string) => setParams(id ? { receiver: id } : {})
  const chooseStation = (s: StationName | null) =>
    setParams(s ? { receiver: s.receiver, station: s.id } : receiver ? { receiver } : {})

  return (
    <>
      <div className="title-row">
        <h2>{t('passes.title')}</h2>
        <div className="chips layout-switch">
          {LAYOUTS.map(l => (
            <button key={l.value} className={layout === l.value ? 'chip on' : 'chip'} onClick={() => setLayout(l.value)}>
              {t(l.label)}
            </button>
          ))}
        </div>
      </div>
      {(several || shown.length > 1) && (
        <div className="filters">
          {several && (
            <div className="chips">
              <button className={receiver === '' ? 'chip on' : 'chip'} onClick={() => chooseReceiver('')}>{t('passes.allReceivers')}</button>
              {receivers.map(r => (
                <button key={r.id} className={receiver === r.id ? 'chip on' : 'chip'} onClick={() => chooseReceiver(r.id)}>{r.name}</button>
              ))}
            </div>
          )}
          {shown.length > 1 && (
            <div className="chips">
              <button className={station === '' ? 'chip on' : 'chip'} onClick={() => chooseStation(null)}>{t('passes.allStations')}</button>
              {shown.map(s => (
                <button key={`${s.receiver}/${s.id}`} className={station === s.id && receiver === s.receiver ? 'chip on' : 'chip'}
                  onClick={() => chooseStation(s)}>
                  {s.name}{several && !receiver && <span className="hint"> · {receiverName(s.receiver)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!loading && !error && passes.length === 0 && (
        <section>
          <p className="hint">
            {t('passes.none')}{admin && <> {t('passes.noneAdmin')}</>}
          </p>
        </section>
      )}
      {passes.length > 0 && layout === 'grid' && <Grid passes={passes} several={several} />}
      {passes.length > 0 && layout === 'list' && <List passes={passes} several={several} />}
      {passes.length > 0 && layout === 'globe' && <PassesGlobe passes={passes} stations={shown} several={several} />}
      {more && layout !== 'globe' && (
        <div className="row"><button disabled={loading} onClick={older}>{t('passes.older')}</button></div>
      )}
      {loading && <p className="hint">{t('common.loading')}</p>}
    </>
  )
}

/** Items under a heading per day; newest first. */
function byDay(passes: PassCard[], item: (p: PassCard) => ReactNode): ReactNode[] {
  const items: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    if (dayLabel(p.time) !== day) {
      day = dayLabel(p.time)
      items.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    items.push(item(p))
  }
  return items
}

function Grid({ passes, several }: { passes: PassCard[]; several: boolean }) {
  return <div className="gallery">{byDay(passes, p => <Card key={p.id} pass={p} several={several} />)}</div>
}

function List({ passes, several }: { passes: PassCard[]; several: boolean }) {
  return <div className="pass-list">{byDay(passes, p => <Row key={p.id} pass={p} several={several} />)}</div>
}

/** Where it was received: the station, and the receiver when there are several. */
const where = (p: PassCard, several: boolean) =>
  several && p.station_name ? `${p.station_name} · ${p.receiver_name}` : p.station_name ?? p.receiver_name

function SignalLine({ pass }: { pass: PassCard }) {
  const t = useT()
  if (pass.max_el == null && pass.peak_snr == null) return null
  return (
    <span>
      {pass.max_el != null && <span className={`el q-${elevationQuality(pass.max_el)}`}>{t('passes.maxEl', { el: Math.round(pass.max_el) })}</span>}
      {pass.max_el != null && pass.peak_snr != null && ' · '}
      {pass.peak_snr != null && t('passes.snr', { snr: pass.peak_snr.toFixed(1) })}
    </span>
  )
}

function ImagesLine({ pass }: { pass: PassCard }) {
  const t = useT()
  // signed out, the hub doesn't tell how many images there are
  const parts = [
    pass.coverage != null && t('passes.received', { p: percent(pass.coverage) }),
    pass.images != null && (pass.images === 1 ? t('passes.oneImage') : t('passes.images', { n: pass.images })),
  ].filter(Boolean)
  return parts.length ? <span className="hint">{parts.join(' · ')}</span> : null
}

function Card({ pass, several }: { pass: PassCard; several: boolean }) {
  const t = useT()
  return (
    <div className="card pass-card">
      {pass.main
        ? <img src={fileUrl(pass.receiver, pass.pass, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">{t('passes.noImages')}</div>}
      <div className="caption">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}><b>{pass.satellite}</b></Link>
          <span className="hint">{where(pass, several)}</span>
        </div>
        <span>{longDate(pass.time)}</span>
        <SignalLine pass={pass} />
        <ImagesLine pass={pass} />
      </div>
    </div>
  )
}

/** One line per pass: a small image, the facts, and the signal over the pass. */
function Row({ pass, several }: { pass: PassCard; several: boolean }) {
  return (
    <div className="pass-row">
      {pass.main
        ? <img src={fileUrl(pass.receiver, pass.pass, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage" />}
      <div className="pass-row-text">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}>
            <b>{pass.satellite}</b> <span className="hint">{clock(pass.time)}</span>
          </Link>
        </div>
        <span className="hint">{where(pass, several)}</span>
        <SignalLine pass={pass} />
        <ImagesLine pass={pass} />
      </div>
      {pass.signal ? <RowChart id={pass.id} /> : <div className="pass-row-chart" />}
    </div>
  )
}

const signals = new Map<string, Promise<SignalThumb | null>>()     // per page load

/** The pass's signal chart, bare; loaded once, when the row comes into view. */
function RowChart({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [signal, setSignal] = useState<SignalThumb | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let alive = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      observer.disconnect()
      let request = signals.get(id)
      if (!request) {
        request = api.signal(id).catch(() => null)
        signals.set(id, request)
      }
      request.then(s => alive && setSignal(s))
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => { alive = false; observer.disconnect() }
  }, [id])
  return (
    <div ref={box} className="pass-row-chart">
      {signal && signal.samples.length > 0 && <SignalChart signal={signal} bare />}
    </div>
  )
}
