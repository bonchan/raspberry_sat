import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, fileUrl, imageLabel, type PassDetail as Pass, type SignalThumb, type SyncPoint } from '../api'
import { clock, compass, duration, elevationQuality, longDate, percent, utc } from '../format'
import SignalChart from '../SignalChart'
import SkyPlot from '../SkyPlot'

// pass.json comes from the Pi: show only what is there
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** "15° elevation at 17:49, S", as on the Pi */
const syncAt = (s: SyncPoint) =>
  `${isNum(s.el) ? s.el.toFixed(0) : '?'}° elevation at ${clock(s.t)}, ${isNum(s.az) ? compass(s.az) : '?'}`

/** One pass: the image (any of those sent, large), its facts; admins can delete it. */
export default function PassDetail({ admin }: { admin: boolean }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [pass, setPass] = useState<Pass | null>(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [chart, setChart] = useState<SignalThumb | null>(null)

  useEffect(() => {
    let alive = true
    setChart(null)
    api.pass(id).then(p => {
      if (!alive) return
      setPass(p)
      setShown(p.main ?? p.images[0]?.path ?? null)
      if (p.signal) api.signal(id).then(s => alive && setChart(s), () => {})
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
        <div className="pass-top hub-pass-top">
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
          <div>
            {/* the same facts, in the same words, as the Pi's pass page; then where it came from */}
            <dl className="facts">
              <dt>Time</dt><dd>{longDate(pass.time)} ({utc(pass.time)})</dd>
              {orbit && isNum(orbit.max_el) && <>
                <dt>Highest elevation</dt>
                <dd>
                  <span className={`el q-${elevationQuality(orbit.max_el)}`}>{orbit.max_el.toFixed(1)}°</span>
                  {isNum(orbit.tca) && <> at {clock(orbit.tca)}</>}
                </dd>
              </>}
              {orbit && isNum(orbit.aos) && isNum(orbit.los) && <>
                <dt>Above the horizon</dt>
                <dd>
                  {clock(orbit.aos)} – {clock(orbit.los)} ({duration(orbit.los - orbit.aos)})
                  {isNum(orbit.aos_az) && isNum(orbit.los_az) && <>, {compass(orbit.aos_az)} → {compass(orbit.los_az)}</>}
                </dd>
              </>}
              {signal && isNum(signal.peak_snr) && isNum(signal.mean_snr) && <>
                <dt>Signal (SNR)</dt><dd>peak {signal.peak_snr.toFixed(1)} dB, average {signal.mean_snr.toFixed(1)} dB</dd>
              </>}
              {signal && isNum(signal.locked) && <>
                <dt>Locked</dt>
                <dd>{percent(signal.locked)}{isNum(signal.seconds) && <> of {duration(signal.seconds)} recorded</>}</dd>
              </>}
              {isNum(coverage) && <><dt>Received</dt><dd>{percent(coverage)} of the main image</dd></>}
              {signal?.first_sync && <><dt>First sync</dt><dd>{syncAt(signal.first_sync)}</dd></>}
              {signal?.last_sync && <><dt>Last sync</dt><dd>{syncAt(signal.last_sync)}</dd></>}
              {where && <><dt>Station</dt><dd>{where.name ?? where.id}
                {isNum(where.lat) && isNum(where.lon) && <span className="hint"> ({where.lat.toFixed(3)}, {where.lon.toFixed(3)})</span>}
              </dd></>}
              <dt>Receiver</dt><dd>{pass.receiver.name}</dd>
              <dt>Uploaded</dt><dd>{longDate(pass.uploaded_at)}</dd>
            </dl>
            {orbit?.track && orbit.track.length > 1 && <SkyPlot track={orbit.track} signal={chart} />}
          </div>
        </div>
        {admin && <div className="row" style={{ marginTop: 12 }}><button className="danger" onClick={remove}>Delete pass</button></div>}
      </section>
      {chart && chart.samples.length > 0 && (
        <section>
          <h2>Signal over the pass</h2>
          <SignalChart signal={chart} />
        </section>
      )}
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
