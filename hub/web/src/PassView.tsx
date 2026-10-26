// One pass as the pass page shows it: the image (any of those it may show, large), the same facts in the
// same words as the Pi's pass page, the sky plot under them, the signal chart below. Also the sign-in page's
// latest pass. What the hub didn't send (signed out: other images, the sky track, the signal) isn't drawn.

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fileUrl, imageLabel, type PassDetail as Pass, type SignalThumb, type SyncPoint } from './api'
import { clock, compass, duration, elevationQuality, longDate, percent, utc } from './format'
import { useT } from './i18n'
import SignalChart from './SignalChart'
import SkyPlot from './SkyPlot'

// pass.json comes from the Pi: show only what is there
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** label: a line over the title; note: under the facts; onDelete: the Delete button (admins) */
export default function PassView({ pass, chart, label, note, onDelete }: {
  pass: Pass; chart: SignalThumb | null; label?: string; note?: ReactNode; onDelete?: () => void
}) {
  const t = useT()
  const [shown, setShown] = useState<string | null>(pass.main ?? pass.images[0]?.path ?? null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => { setShown(pass.main ?? pass.images[0]?.path ?? null) }, [pass.id])

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

  const image = pass.images.find(i => i.path === shown)
  const { orbit, signal } = pass.meta
  const coverage = pass.meta.coverage
  const where = pass.station
  return (
    <>
      <section>
        {label && <div className="overline">{label}</div>}
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
            {note}
          </div>
        </div>
        {onDelete && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="danger" onClick={onDelete}>{t('detail.delete')}</button>
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
