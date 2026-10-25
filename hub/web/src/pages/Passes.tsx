import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fileUrl, type PassCard, type StationName } from '../api'
import { dayLabel, elevationQuality, longDate, percent } from '../format'

/** Every station's passes, newest first, under a heading per day; a station filter when there are several. */
export default function Passes({ admin }: { admin: boolean }) {
  const [params, setParams] = useSearchParams()
  const station = params.get('station') ?? ''
  const [passes, setPasses] = useState<PassCard[]>([])
  const [stations, setStations] = useState<StationName[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    api.passes({ station: station || undefined })
      .then(r => {
        if (!alive) return
        setPasses(r.passes)
        setMore(r.more)
        setStations(r.stations)
      }, e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [station])

  async function older() {
    setLoading(true)
    try {
      const r = await api.passes({ before: passes[passes.length - 1].time, station: station || undefined })
      setPasses(p => [...p, ...r.passes])
      setMore(r.more)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const choose = (id: string) => setParams(id ? { station: id } : {})

  return (
    <section>
      <div className="title-row">
        <h2>Passes</h2>
        {stations.length > 1 && (
          <div className="chips layout-switch">
            <button className={station === '' ? 'chip on' : 'chip'} onClick={() => choose('')}>All stations</button>
            {stations.map(s => (
              <button key={s.id} className={station === s.id ? 'chip on' : 'chip'} onClick={() => choose(s.id)}>{s.name}</button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && !error && passes.length === 0 && (
        <p className="hint">
          No passes yet.{admin && ' Add a station on the Stations page, then paste its URL and token into the station\'s settings.'}
        </p>
      )}
      <Grid passes={passes} />
      {more && <div className="row" style={{ marginTop: 12 }}><button disabled={loading} onClick={older}>Older passes</button></div>}
      {loading && <p className="hint">Loading…</p>}
    </section>
  )
}

function Grid({ passes }: { passes: PassCard[] }) {
  const items: ReactNode[] = []
  let day = ''
  for (const p of passes) {
    if (dayLabel(p.time) !== day) {
      day = dayLabel(p.time)
      items.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    items.push(<Card key={p.id} pass={p} />)
  }
  return <div className="gallery">{items}</div>
}

function Card({ pass }: { pass: PassCard }) {
  return (
    <div className="card pass-card">
      {pass.main
        ? <img src={fileUrl(pass.station, pass.pass, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">No images</div>}
      <div className="caption">
        <div className="title-row">
          <Link className="card-link" to={`/passes/${encodeURIComponent(pass.id)}`}><b>{pass.satellite}</b></Link>
          <span className="hint">{pass.station_name}</span>
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
