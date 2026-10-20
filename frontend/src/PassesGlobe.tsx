// The Passes page's globe layout: the globe with the chosen passes' images draped where they were
// taken, and under it every pass as a card, like the grid layout, to put it on the globe or fly to it.
// The newest day's passes start on the globe.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { passFile, type PassSummary } from './api'
import { longDate } from './format'
import Globe, { usePassDrapes } from './Globe'
import { useT } from './i18n'
import { elevationQuality } from './UpcomingPasses'

const dayOf = (time: number) => new Date(time * 1000).toDateString()

/** passes: newest first, as the pass list has them */
export default function PassesGlobe({ passes }: { passes: PassSummary[] }) {
  const t = useT()
  const withImages = passes.filter(p => p.main)
  const [shown, setShown] = useState<Set<string>>(() => {
    const newest = withImages[0] ? dayOf(withImages[0].time) : ''
    return new Set(withImages.filter(p => dayOf(p.time) === newest).map(p => p.id))
  })
  const [focus, setFocus] = useState<{ id: string; at: number }>()
  // oldest first, so newer images lie on top where passes overlap
  const { drapes, failed } = usePassDrapes(withImages.filter(p => shown.has(p.id)).reverse())

  function show(id: string, on: boolean) {
    setShown(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  if (withImages.length === 0) return <section><p className="hint">{t('passes.noImagesYet')}</p></section>

  return (
    <div className="passes-globe">
      <Globe size="tall" drapes={drapes} focus={focus} />
      <p className="hint">{t('passes.globeHint')}</p>
      <div className="gallery">
        {withImages.map(p => (
          <div key={p.id} className={shown.has(p.id) ? 'card globe-card on' : 'card globe-card'}>
            <img src={passFile(p.id, 'thumb', p.main!)} alt="" loading="lazy" onClick={() => show(p.id, !shown.has(p.id))} />
            <div className="caption">
              <Link to={`/passes/${encodeURIComponent(p.id)}`}><b>{p.satellite}</b></Link>
              <span>
                {longDate(p.time)}
                {p.max_el != null && <> · <span className={`el q-${elevationQuality(p.max_el)}`}>{t('passes.maxEl', { el: Math.round(p.max_el) })}</span></>}
              </span>
              <div className="globe-card-actions">
                <label>
                  <input type="checkbox" checked={shown.has(p.id)} onChange={e => show(p.id, e.target.checked)} />
                  {t('passes.onGlobe')}
                </label>
                {failed.includes(p.id)
                  ? <span className="hint">{t('passes.cantPlace')}</span>
                  : <button className="chip" onClick={() => { show(p.id, true); setFocus({ id: p.id, at: Date.now() }) }}>
                      {t('passes.flyTo')}
                    </button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
