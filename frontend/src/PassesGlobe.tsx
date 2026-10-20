// The Passes page's globe layout: the globe stays at the top with one pass's image draped where it was
// taken, and under it every pass as a card, like the grid layout. Clicking a card puts that pass on the
// globe (only one at a time: overlapping images would hide each other) and flies there. It starts with
// the newest pass, seen from straight above.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { passFile, type PassSummary } from './api'
import { longDate } from './format'
import Globe, { usePassDrapes } from './Globe'
import { useT } from './i18n'
import { elevationQuality } from './UpcomingPasses'

/** passes: newest first, as the pass list has them */
export default function PassesGlobe({ passes }: { passes: PassSummary[] }) {
  const t = useT()
  const withImages = passes.filter(p => p.main)
  const [selected, setSelected] = useState<string>()
  const chosen = withImages.find(p => p.id === selected) ?? withImages[0]
  const [focus, setFocus] = useState<{ id: string; at: number; instant?: boolean } | undefined>(
    () => withImages[0] && { id: withImages[0].id, at: 0, instant: true })
  const { drapes, failed } = usePassDrapes(chosen ? [chosen] : [])

  function choose(id: string) {
    setSelected(id)
    setFocus({ id, at: Date.now() })
  }

  if (!chosen) return <section><p className="hint">{t('passes.noImagesYet')}</p></section>

  return (
    <div className="passes-globe">
      <Globe size="tall" drapes={drapes} focus={focus} />
      <div className="gallery">
        {withImages.map(p => {
          const on = p.id === chosen.id
          return (
            <div key={p.id} className={on ? 'card globe-card on' : 'card globe-card'} onClick={() => choose(p.id)}>
              <img src={passFile(p.id, 'thumb', p.main!)} alt="" loading="lazy" />
              <div className="caption">
                <Link to={`/passes/${encodeURIComponent(p.id)}`} onClick={e => e.stopPropagation()}><b>{p.satellite}</b></Link>
                <span>
                  {longDate(p.time)}
                  {p.max_el != null && <> · <span className={`el q-${elevationQuality(p.max_el)}`}>{t('passes.maxEl', { el: Math.round(p.max_el) })}</span></>}
                </span>
                {on && (failed.includes(p.id)
                  ? <span className="hint">{t('passes.cantPlace')}</span>
                  : <span className="ok">{t('passes.onGlobe')}</span>)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
