// The Passes page's globe layout: one day's passes, each image draped where it was taken, with a list
// beside the globe to hide a pass or fly to it, and arrows to go to the day before or after.

import { useState } from 'react'
import type { PassSummary } from './api'
import { clock } from './format'
import Globe, { usePassDrapes } from './Globe'
import { useT } from './i18n'
import { elevationQuality } from './UpcomingPasses'

const dayOf = (time: number) => new Date(time * 1000).toDateString()

/** passes: newest first, as the pass list has them; dayLabel: "Today", "Yesterday" or the date */
export default function PassesGlobe({ passes, dayLabel }: { passes: PassSummary[]; dayLabel: (time: number) => string }) {
  const t = useT()
  const withImages = passes.filter(p => p.main)
  const days = [...new Set(withImages.map(p => dayOf(p.time)))]
  const [chosen, setChosen] = useState<string | null>(null)
  const day = chosen && days.includes(chosen) ? chosen : days[0]
  const index = days.indexOf(day)
  const ofDay = withImages.filter(p => dayOf(p.time) === day).reverse()      // in the order they happened
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [focus, setFocus] = useState<{ id: string; at: number }>()
  const { drapes, failed, ready } = usePassDrapes(ofDay.filter(p => !hidden.has(p.id)))

  function toggle(id: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  if (withImages.length === 0) return <section><p className="hint">{t('passes.noImagesYet')}</p></section>

  return (
    <div className="passes-globe">
      <Globe size="tall" drapes={drapes} focus={focus} />
      <aside className="passes-globe-side">
        <div className="day-nav">
          <button aria-label={t('passes.olderDay')} disabled={index >= days.length - 1}
            onClick={() => setChosen(days[index + 1])}>‹</button>
          <b>{dayLabel(ofDay[0].time)}</b>
          <button aria-label={t('passes.newerDay')} disabled={index <= 0}
            onClick={() => setChosen(days[index - 1])}>›</button>
        </div>
        <ul className="globe-passes">
          {ofDay.map(p => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} />
                <span>
                  {p.satellite} <span className="hint">{clock(p.time)}</span>
                  {p.max_el != null && <> <span className={`el q-${elevationQuality(p.max_el)}`}>{Math.round(p.max_el)}°</span></>}
                </span>
              </label>
              {failed.includes(p.id)
                ? <span className="hint">{t('passes.cantPlace')}</span>
                : <button className="chip" disabled={!drapes.some(d => d.id === p.id)}
                    onClick={() => setFocus({ id: p.id, at: Date.now() })}>{t('passes.flyTo')}</button>}
            </li>
          ))}
        </ul>
        {!ready && <p className="hint">{t('common.loading')}</p>}
        <p className="hint">{t('passes.globeHint')}</p>
      </aside>
    </div>
  )
}
