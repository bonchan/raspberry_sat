// The Passes page's globe layout, as on the Pi: the globe fills the window's height with one pass's image
// draped where it was taken, and the receivers' stations as dots; beside it every pass that can be placed as
// a card, three per row under a heading per day, in their own scroll. Clicking a card puts that pass on the
// globe (one at a time: overlapping images would hide each other) and flies there.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, fileUrl, type PassCard, type PassGeo, type StationName } from './api'
import { dayLabel, longDate } from './format'
import Globe, { type Drape, type Place } from './Globe'
import { useT } from './i18n'

const geoCache = new Map<string, Promise<PassGeo | null>>()     // per page load; null: can't be placed

function geoOf(id: string): Promise<PassGeo | null> {
  let geo = geoCache.get(id)
  if (!geo) {
    geo = api.geo(id).catch(() => null)
    geoCache.set(id, geo)
  }
  return geo
}

/** passes: newest first, as the page has them; several: more than one receiver (cards name it too) */
export default function PassesGlobe({ passes, stations, several }: {
  passes: PassCard[]; stations: StationName[]; several: boolean
}) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const placeable = passes.filter(p => p.main && p.drape)
  const [selected, setSelected] = useState<string>()
  const chosen = placeable.find(p => p.id === selected) ?? placeable[0]
  const [focus, setFocus] = useState<{ id: string; at: number; instant?: boolean } | undefined>(
    () => placeable[0] && { id: placeable[0].id, at: 0, instant: true })
  const [drape, setDrape] = useState<Drape | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    if (!chosen) return
    let alive = true
    geoOf(chosen.id).then(geo => {
      if (!alive) return
      setDrape(geo && { id: chosen.id, geo, url: fileUrl(chosen.receiver, chosen.pass, 'large', geo.image) })
      setFailed(geo ? '' : chosen.id)
    })
    return () => { alive = false }
  }, [chosen?.id])

  function choose(id: string) {
    setSelected(id)
    setFocus({ id, at: Date.now() })
  }

  // from where it starts to the bottom of the window, so only the cards scroll (as on the Pi)
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
    document.documentElement.classList.add('page-fixed', 'page-wide')
    return () => {
      window.removeEventListener('resize', fit)
      observer.disconnect()
      document.documentElement.classList.remove('page-fixed', 'page-wide')
    }
  }, [])

  if (!chosen) {
    return (
      <section ref={box}>
        <p className="hint">{t('globe.none')}</p>
      </section>
    )
  }

  const places: Place[] = stations.flatMap(s => (s.lat == null || s.lon == null ? [] : [{
    key: `${s.receiver}/${s.id}`, name: s.name, lat: s.lat, lon: s.lon,
  }]))
  const cards: ReactNode[] = []
  let day = ''
  for (const p of placeable) {
    if (dayLabel(p.time) !== day) {
      day = dayLabel(p.time)
      cards.push(<h3 key={`day-${p.id}`} className="pass-day">{day}</h3>)
    }
    const on = p.id === chosen.id
    const where = p.station_name ?? p.receiver_name
    cards.push(
      <div key={p.id} className={on ? 'card globe-card on' : 'card globe-card'} onClick={() => choose(p.id)}>
        <img src={fileUrl(p.receiver, p.pass, 'thumb', p.main!)} alt="" loading="lazy" />
        <div className="caption">
          {/* the name opens the pass's page; the rest of the card puts it on the globe */}
          <Link to={`/passes/${encodeURIComponent(p.id)}`} onClick={e => e.stopPropagation()}><b>{p.satellite}</b></Link>
          <span>{longDate(p.time)}</span>
          <span className="hint">{several && p.station_name ? `${where} · ${p.receiver_name}` : where}</span>
          {on && failed === p.id && <span className="hint">{t('globe.cantPlace')}</span>}
        </div>
      </div>,
    )
  }

  return (
    <div className="passes-globe" ref={box}>
      <Globe drapes={drape ? [drape] : []} focus={focus} places={places} />
      <div className="globe-gallery">{cards}</div>
    </div>
  )
}
