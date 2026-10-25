import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fileUrl, type PassCard, type ReceiverName, type StationName } from '../api'
import { dayLabel, elevationQuality, longDate, percent } from '../format'

/** Every receiver's passes, newest first, under a heading per day. Filters by receiver (Pi) and by station
    (one of its places) when there is more than one to choose from. */
export default function Passes({ admin }: { admin: boolean }) {
  const [params, setParams] = useSearchParams()
  const receiver = params.get('receiver') ?? ''
  const station = params.get('station') ?? ''
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
    <section>
      <div className="title-row">
        <h2>Passes</h2>
        <div className="filters">
          {several && (
            <div className="chips">
              <button className={receiver === '' ? 'chip on' : 'chip'} onClick={() => chooseReceiver('')}>All receivers</button>
              {receivers.map(r => (
                <button key={r.id} className={receiver === r.id ? 'chip on' : 'chip'} onClick={() => chooseReceiver(r.id)}>{r.name}</button>
              ))}
            </div>
          )}
          {shown.length > 1 && (
            <div className="chips">
              <button className={station === '' ? 'chip on' : 'chip'} onClick={() => chooseStation(null)}>All stations</button>
              {shown.map(s => (
                <button key={`${s.receiver}/${s.id}`} className={station === s.id && receiver === s.receiver ? 'chip on' : 'chip'}
                  onClick={() => chooseStation(s)}>
                  {s.name}{several && !receiver && <span className="hint"> · {receiverName(s.receiver)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && !error && passes.length === 0 && (
        <p className="hint">
          No passes yet.{admin && ' Add a receiver on the Receivers page, then paste its URL and token into the Pi\'s settings.'}
        </p>
      )}
      <Grid passes={passes} several={several} />
      {more && <div className="row" style={{ marginTop: 12 }}><button disabled={loading} onClick={older}>Older passes</button></div>}
      {loading && <p className="hint">Loading…</p>}
    </section>
  )
}

function Grid({ passes, several }: { passes: PassCard[]; several: boolean }) {
  const items: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    if (dayLabel(p.time) !== day) {
      day = dayLabel(p.time)
      items.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    items.push(<Card key={p.id} pass={p} several={several} />)
  }
  return <div className="gallery">{items}</div>
}

/** `several`: more than one receiver, so the card names its receiver too. */
function Card({ pass, several }: { pass: PassCard; several: boolean }) {
  const where = pass.station_name ?? pass.receiver_name
  return (
    <div className="card pass-card">
      {pass.main
        ? <img src={fileUrl(pass.receiver, pass.pass, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">No images</div>}
      <div className="caption">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}><b>{pass.satellite}</b></Link>
          <span className="hint">{several && pass.station_name ? `${where} · ${pass.receiver_name}` : where}</span>
        </div>
        <span>{longDate(pass.time)}</span>
        {(pass.max_el != null || pass.peak_snr != null) && (
          <span>
            {pass.max_el != null && <span className={`el q-${elevationQuality(pass.max_el)}`}>max {Math.round(pass.max_el)}°</span>}
            {pass.max_el != null && pass.peak_snr != null && ' · '}
            {pass.peak_snr != null && `SNR ${pass.peak_snr.toFixed(1)} dB`}
          </span>
        )}
        <span className="hint">
          {pass.coverage != null && <>{percent(pass.coverage)} received · </>}
          {pass.images === 1 ? '1 image' : `${pass.images} images`}
        </span>
      </div>
    </div>
  )
}
