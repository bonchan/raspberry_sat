import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, fileUrl, imageLabel, type PassDetail as Pass } from '../api'
import { elevationQuality, longDate, percent, utc } from '../format'

// pass.json comes from the Pi: show only what is there
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One pass: the image (any of those sent, large), its facts; admins can delete it. */
export default function PassDetail({ admin }: { admin: boolean }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [pass, setPass] = useState<Pass | null>(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let alive = true
    api.pass(id).then(p => {
      if (!alive) return
      setPass(p)
      setShown(p.main ?? p.images[0]?.path ?? null)
    }, e => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    if (!zoom) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [zoom])

  async function remove() {
    if (!pass || !confirm(`Delete this pass of ${pass.receiver.name} from the hub? The Pi keeps its own copy.`)) return
    try {
      await api.deletePass(pass.id)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <section><p className="error">{error}</p><Link to="/">All passes</Link></section>
  if (!pass) return <section><p className="hint">Loading…</p></section>

  const image = pass.images.find(i => i.path === shown)
  const { orbit, signal } = pass.meta
  const coverage = pass.meta.coverage
  const where = pass.station
  return (
    <>
      <section>
        <div className="title-row">
          <h2>{pass.satellite} · {where?.name ?? pass.receiver.name}</h2>
          <Link to="/">All passes</Link>
        </div>
        <div className="pass-top">
          <div>
            {image
              ? <img className="hero" src={fileUrl(pass.receiver.id, pass.pass, 'large', image.path)} alt={imageLabel(image)}
                  onClick={() => setZoom(true)} />
              : <div className="noimage">No images</div>}
            {pass.images.length > 1 && (
              <div className="chips">
                {pass.images.map(i => (
                  <button key={i.path} className={i.path === shown ? 'chip on' : 'chip'} onClick={() => setShown(i.path)}>
                    {imageLabel(i)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <dl className="facts">
            <dt>Time</dt><dd>{longDate(pass.time)}<br /><span className="hint">{utc(pass.time)}</span></dd>
            {where && <><dt>Station</dt><dd>{where.name ?? where.id}
              {isNum(where.lat) && isNum(where.lon) && <><br /><span className="hint">{where.lat.toFixed(3)}, {where.lon.toFixed(3)}</span></>}
            </dd></>}
            <dt>Receiver</dt><dd>{pass.receiver.name}</dd>
            {orbit && isNum(orbit.max_el) && <><dt>Highest</dt><dd>
              <span className={`el q-${elevationQuality(orbit.max_el)}`}>{Math.round(orbit.max_el)}°</span></dd></>}
            {signal && isNum(signal.peak_snr) && isNum(signal.mean_snr) && <><dt>Signal</dt><dd>
              peak {signal.peak_snr.toFixed(1)} dB, mean {signal.mean_snr.toFixed(1)} dB
              {isNum(signal.locked) && <><br /><span className="hint">locked {percent(signal.locked)} of the time</span></>}</dd></>}
            {isNum(coverage) && <><dt>Received</dt><dd>{percent(coverage)} of the main image</dd></>}
            {image?.width && image.height && <><dt>Size</dt><dd>{image.width} × {image.height} px on the Pi</dd></>}
            <dt>Uploaded</dt><dd>{longDate(pass.uploaded_at)}</dd>
          </dl>
        </div>
        {admin && <div className="row" style={{ marginTop: 12 }}><button className="danger" onClick={remove}>Delete pass</button></div>}
      </section>
      {zoom && image && (
        <div className="lightbox" onClick={() => setZoom(false)}>
          <img src={fileUrl(pass.receiver.id, pass.pass, 'large', image.path)} alt={imageLabel(image)} />
          <div className="lightbox-bar">
            <span>{imageLabel(image)}</span>
            <button onClick={() => setZoom(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
