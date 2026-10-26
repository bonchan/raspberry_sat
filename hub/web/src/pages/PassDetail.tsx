import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, fileUrl, imageLabel, type PassDetail as Pass, type SignalThumb, type SyncPoint } from '../api'
import { clock, compass, duration, elevationQuality, longDate, percent, utc } from '../format'
import { useT } from '../i18n'
import SignalChart from '../SignalChart'
import SkyPlot from '../SkyPlot'

// pass.json comes from the Pi: show only what is there
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One pass: the image (any of those sent, large), its facts; admins can delete it. */
export default function PassDetail({ admin }: { admin: boolean }) {
  const t = useT()
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

  /** "15° elevation at 17:49, S", as on the Pi */
  const syncAt = (s: SyncPoint) => t('detail.syncAt', {
    el: isNum(s.el) ? s.el.toFixed(0) : '?', time: clock(s.t), dir: isNum(s.az) ? compass(s.az) : '?',
  })

  async function remove() {
    if (!pass || !confirm(t('detail.confirmDelete', { receiver: pass.receiver.name }))) return
    try {
      await api.deletePass(pass.id)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <section><p className="error">{error}</p><Link to="/">{t('common.allPasses')}</Link></section>
  if (!pass) return <section><p className="hint">{t('common.loading')}</p></section>

  const image = pass.images.find(i => i.path === shown)
  const { orbit, signal } = pass.meta
  const coverage = pass.meta.coverage
  const where = pass.station
  return (
    <>
      <section>
        <div className="title-row">
          <h2>{pass.satellite} · {where?.name ?? pass.receiver.name}</h2>
          <Link to="/">{t('common.allPasses')}</Link>
        </div>
        <div className="pass-top hub-pass-top">
          <div>
            {image
              ? <img className="hero" src={fileUrl(pass.receiver.id, pass.pass, 'large', image.path)} alt={imageLabel(image)}
                  onClick={() => setZoom(true)} />
              : <div className="noimage">{t('detail.noImages')}</div>}
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
              <dt>{t('detail.time')}</dt><dd>{longDate(pass.time)} ({utc(pass.time)})</dd>
              {orbit && isNum(orbit.max_el) && <>
                <dt>{t('detail.maxEl')}</dt>
                <dd>
                  <span className={`el q-${elevationQuality(orbit.max_el)}`}>{orbit.max_el.toFixed(1)}°</span>
                  {isNum(orbit.tca) && <> {t('detail.at', { time: clock(orbit.tca) })}</>}
                </dd>
              </>}
              {orbit && isNum(orbit.aos) && isNum(orbit.los) && <>
                <dt>{t('detail.overSky')}</dt>
                <dd>
                  {clock(orbit.aos)} – {clock(orbit.los)} ({duration(orbit.los - orbit.aos)})
                  {isNum(orbit.aos_az) && isNum(orbit.los_az) && <>, {compass(orbit.aos_az)} → {compass(orbit.los_az)}</>}
                </dd>
              </>}
              {signal && isNum(signal.peak_snr) && isNum(signal.mean_snr) && <>
                <dt>{t('detail.signal')}</dt>
                <dd>{t('detail.signalValue', { peak: signal.peak_snr.toFixed(1), mean: signal.mean_snr.toFixed(1) })}</dd>
              </>}
              {signal && isNum(signal.locked) && <>
                <dt>{t('detail.locked')}</dt>
                <dd>{isNum(signal.seconds)
                  ? t('detail.lockedValue', { p: percent(signal.locked), d: duration(signal.seconds) })
                  : percent(signal.locked)}</dd>
              </>}
              {isNum(coverage) && <>
                <dt>{t('detail.received')}</dt><dd>{t('detail.receivedValue', { p: percent(coverage) })}</dd>
              </>}
              {signal?.first_sync && <><dt>{t('detail.firstSync')}</dt><dd>{syncAt(signal.first_sync)}</dd></>}
              {signal?.last_sync && <><dt>{t('detail.lastSync')}</dt><dd>{syncAt(signal.last_sync)}</dd></>}
              {where && <><dt>{t('detail.station')}</dt><dd>{where.name ?? where.id}
                {isNum(where.lat) && isNum(where.lon) && <span className="hint"> ({where.lat.toFixed(3)}, {where.lon.toFixed(3)})</span>}
              </dd></>}
              <dt>{t('detail.receiver')}</dt><dd>{pass.receiver.name}</dd>
              <dt>{t('detail.uploaded')}</dt><dd>{longDate(pass.uploaded_at)}</dd>
            </dl>
            {orbit?.track && orbit.track.length > 1 && <SkyPlot track={orbit.track} signal={chart} />}
          </div>
        </div>
        {admin && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="danger" onClick={remove}>{t('detail.delete')}</button>
          </div>
        )}
      </section>
      {chart && chart.samples.length > 0 && (
        <section>
          <h2>{t('detail.signalChart')}</h2>
          <SignalChart signal={chart} />
        </section>
      )}
      {zoom && image && (
        <div className="lightbox" onClick={() => setZoom(false)}>
          <img src={fileUrl(pass.receiver.id, pass.pass, 'large', image.path)} alt={imageLabel(image)} />
          <div className="lightbox-bar">
            <span>{imageLabel(image)}</span>
            <button onClick={() => setZoom(false)}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </>
  )
}
