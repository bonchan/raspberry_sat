// The Passes page's globe layout: the globe fills the window's height with one pass's image draped where
// it was taken; beside it every pass as a card, two per row under a heading per day, in their own scroll.
// Clicking a card puts that pass on the globe (only one at a time: overlapping images would hide each
// other) and flies there. It starts with the newest pass, seen from straight above.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { passFile, type PassSummary } from './api'
import { longDate } from './format'
import Globe, { usePassDrapes } from './Globe'
import { useT } from './i18n'

/** passes: newest first, as the pass list has them; dayLabel: "Today", "Yesterday" or the date */
export default function PassesGlobe({ passes, dayLabel }: { passes: PassSummary[]; dayLabel: (time: number) => string }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
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

  // from where it starts to the bottom of the window, whatever the monitor, so only the cards scroll: rounded
  // down (a fraction of a pixel too much would make the page scroll), and measured again when the window or
  // the header (badges come and go) changes size
  useEffect(() => {
    const fit = () => {
      const el = box.current
      if (el) el.style.height = `${Math.floor(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY)) - 17}px`
    }
    fit()
    window.addEventListener('resize', fit)
    const header = document.querySelector('header')
    const observer = new ResizeObserver(fit)
    if (header) observer.observe(header)
    document.documentElement.classList.add('page-fixed')
    return () => {
      window.removeEventListener('resize', fit)
      observer.disconnect()
      document.documentElement.classList.remove('page-fixed')
    }
  }, [])

  if (!chosen) return <section><p className="hint">{t('passes.noImagesYet')}</p></section>

  const cards: ReactNode[] = []
  let day = ''
  for (const p of withImages) {
    if (dayLabel(p.time) !== day) {
      day = dayLabel(p.time)
      cards.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    const on = p.id === chosen.id
    cards.push(
            <div key={p.id} className={on ? 'card globe-card on' : 'card globe-card'} onClick={() => choose(p.id)}>
              <img src={passFile(p.id, 'thumb', p.main!)} alt="" loading="lazy" />
              <div className="caption">
                {/* the name opens the pass's page; the rest of the card puts it on the globe */}
                <Link to={`/passes/${encodeURIComponent(p.id)}`} onClick={e => e.stopPropagation()}><b>{p.satellite}</b></Link>
                <span>{longDate(p.time)}</span>
                {on && failed.includes(p.id) && <span className="hint">{t('passes.cantPlace')}</span>}
              </div>
            </div>,
    )
  }

  return (
    <div className="passes-globe" ref={box}>
      <Globe drapes={drapes} focus={focus} />
      <div className="globe-gallery">{cards}</div>
    </div>
  )
}
