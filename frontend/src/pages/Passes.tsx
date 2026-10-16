import { Link } from 'react-router-dom'
import { api, passFile, type PassSummary } from '../api'
import { usePolling } from '../hooks'
import { longDate, percent, size } from '../format'
import { useT } from '../i18n'
import { elevationQuality } from '../UpcomingPasses'

export default function Passes() {
  const t = useT()
  const { data, error } = usePolling(api.getPasses, 15000)

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
        <div className="gallery">
          {data.passes.map(p => <PassCard key={p.id} pass={p} />)}
        </div>
      )}
    </>
  )
}

function PassCard({ pass }: { pass: PassSummary }) {
  const t = useT()
  return (
    <Link className="card" to={`/passes/${encodeURIComponent(pass.id)}`}>
      {pass.main
        ? <img src={passFile(pass.id, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">{t('passes.noImages')}</div>}
      <div className="caption">
        <b>{pass.satellite}</b>
        <span>{longDate(pass.time)}</span>
        {(pass.max_el != null || pass.peak_snr != null) && (
          <span>
            {pass.max_el != null && (
              <span className={`el q-${elevationQuality(pass.max_el)}`}>{t('passes.maxEl', { el: Math.round(pass.max_el) })}</span>
            )}
            {pass.max_el != null && pass.peak_snr != null && ' · '}
            {pass.peak_snr != null && t('passes.snr', { snr: pass.peak_snr.toFixed(1) })}
            {pass.locked != null && <> · {t('passes.locked', { p: percent(pass.locked) })}</>}
          </span>
        )}
        <span className="hint">
          {pass.coverage !== null && <>{t('passes.received', { p: percent(pass.coverage) })} · </>}
          {t('passes.images', { n: pass.image_count })} · {size(pass.size)}
        </span>
      </div>
    </Link>
  )
}
