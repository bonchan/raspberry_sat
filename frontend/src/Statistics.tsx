// Station statistics on the Status page, worked out here from the pass list: how often reception works,
// the elevations at which it starts and ends, and how pass quality (by highest elevation) turns out.

import { api, type PassSummary, type SyncDrop } from './api'
import Fact, { WAIT } from './Fact'
import { usePolling } from './hooks'
import { compass, longDate, percent, size } from './format'
import { useT, type Key } from './i18n'
import { EXCELLENT, GOOD, elevationQuality } from './UpcomingPasses'

const QUALITIES = ['fair', 'good', 'excellent'] as const
const RANGES = { fair: `< ${GOOD}°`, good: `${GOOD}–${EXCELLENT}°`, excellent: `≥ ${EXCELLENT}°` }

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const known = (values: (number | null | undefined)[]) => values.filter((v): v is number => v != null)

/** passes this app watched live have a signal summary; older ones don't, and are left out of signal figures */
const watched = (passes: PassSummary[]) => passes.filter(p => p.locked != null)

export default function Statistics() {
  const t = useT()
  const { data, error } = usePolling(api.getPasses, 60000)

  // until the pass list arrives, the same rows and table with "…", so the page doesn't move
  if (!data) {
    const rows: Key[] = ['stats.passes', 'stats.satellites', 'stats.synced', 'stats.firstSync', 'stats.lastSync',
                         'stats.snr', 'stats.received', 'stats.storage']
    return (
      <section>
        <h2>{t('stats.title')}</h2>
        {error && <p className="error">{error}</p>}
        <dl className="facts">{rows.map(k => <Fact key={k} label={t(k)} loading value={null} />)}</dl>
        <h3 className="subhead">{t('stats.byQuality')}</h3>
        <QualityTable groups={null} />
        <p className="hint">{t('stats.byQualityHint')}</p>
        <Drops passes={null} />
      </section>
    )
  }
  if (data.passes.length === 0) {
    return <section><h2>{t('stats.title')}</h2><p className="hint">{t('stats.none')}</p></section>
  }

  const all = data.passes
  const now = Date.now() / 1000
  const oldest = Math.min(...all.map(p => p.time))
  const lastWeek = all.filter(p => now - p.time < 7 * 86400).length
  const satellites = new Map<string, number>()
  for (const p of all) satellites.set(p.satellite, (satellites.get(p.satellite) ?? 0) + 1)

  const seen = watched(all)
  const synced = seen.filter(p => p.first_sync)
  const firstEls = known(synced.map(p => p.first_sync?.el))
  const lastEls = known(synced.map(p => p.last_sync?.el))
  const peaks = known(all.map(p => p.peak_snr))
  const received = known(all.map(p => p.coverage))
  const spread = (els: number[]) => t('stats.range', {
    median: median(els)!.toFixed(0), low: Math.min(...els).toFixed(0), high: Math.max(...els).toFixed(0),
  })

  const groups = QUALITIES.map(quality => {
    const passes = all.filter(p => p.max_el != null && elevationQuality(p.max_el) === quality)
    const w = watched(passes)
    return {
      quality, count: passes.length,
      synced: w.length ? w.filter(p => p.first_sync).length / w.length : null,
      lock: median(known(w.map(p => p.locked))),
      received: median(known(passes.map(p => p.coverage))),
      snr: median(known(passes.map(p => p.peak_snr))),
    }
  })
  return (
    <section>
      <h2>{t('stats.title')}</h2>
      <dl className="facts">
        <dt>{t('stats.passes')}</dt>
        <dd>
          {t('stats.passesValue', { n: all.length, date: longDate(oldest) })}
          <span className="hint"> · {t('stats.lastWeek', { n: lastWeek })}</span>
        </dd>
        <dt>{t('stats.satellites')}</dt>
        <dd>{[...satellites].map(([name, n]) => `${name}: ${n}`).join(' · ')}</dd>
        {seen.length > 0 && <>
          <dt>{t('stats.synced')}</dt>
          <dd>
            {t('stats.syncedValue', { n: synced.length, total: seen.length, p: percent(synced.length / seen.length) })}
            {seen.length < all.length && <span className="hint"> · {t('stats.syncedHint')}</span>}
          </dd>
        </>}
        {firstEls.length > 0 && <><dt>{t('stats.firstSync')}</dt><dd>{spread(firstEls)}</dd></>}
        {lastEls.length > 0 && <><dt>{t('stats.lastSync')}</dt><dd>{spread(lastEls)}</dd></>}
        {peaks.length > 0 && <>
          <dt>{t('stats.snr')}</dt>
          <dd>{t('stats.snrValue', { median: median(peaks)!.toFixed(1), best: Math.max(...peaks).toFixed(1) })}</dd>
        </>}
        {received.length > 0 && <>
          <dt>{t('stats.received')}</dt><dd>{t('stats.receivedValue', { p: percent(median(received)!) })}</dd>
        </>}
        <dt>{t('stats.storage')}</dt>
        <dd>{t('stats.storageValue', { size: size(all.reduce((s, p) => s + p.size, 0)),
                                       n: all.reduce((s, p) => s + p.image_count, 0) })}</dd>
      </dl>

      <h3 className="subhead">{t('stats.byQuality')}</h3>
      <QualityTable groups={groups} />
      <p className="hint">{t('stats.byQualityHint')}</p>
      <Drops passes={all} />
    </section>
  )
}

interface Group {
  quality: typeof QUALITIES[number]; count: number
  synced: number | null; lock: number | null; received: number | null; snr: number | null
}

/** One row per pass quality; "…" in every cell while loading (groups null). */
function QualityTable({ groups }: { groups: Group[] | null }) {
  const t = useT()
  const dash = '–'
  const cell = (v: number | null, show: (v: number) => string) => (v == null ? dash : show(v))
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th>{t('stats.quality')}</th><th>{t('stats.count')}</th><th>{t('stats.syncedCol')}</th>
            <th>{t('stats.lockCol')}</th><th>{t('stats.receivedCol')}</th><th>{t('stats.snrCol')}</th>
          </tr>
        </thead>
        <tbody>
          {QUALITIES.map(quality => {
            const g = groups?.find(x => x.quality === quality)
            return (
              <tr key={quality}>
                <td>
                  <span className={`swatch q-${quality}`} />{t(`quality.${quality}` as Key)}{' '}
                  <span className="hint">{RANGES[quality]}</span>
                </td>
                {g ? <>
                  <td>{g.count}</td>
                  <td>{cell(g.synced, percent)}</td>
                  <td>{cell(g.lock, percent)}</td>
                  <td>{cell(g.received, percent)}</td>
                  <td>{cell(g.snr, v => `${v.toFixed(1)} dB`)}</td>
                </> : [0, 1, 2, 3, 4].map(i => <td key={i}>{WAIT}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const BANDS = [0, 10, 20, 30, 40, 50, 60, 70, 80]
const bandOf = (el: number) => Math.min(80, Math.max(0, Math.floor(el / 10) * 10))

/** a fade: the signal went with the sync (antenna, reflections, obstructions); otherwise the signal held
    and only the lock was lost (the Pi or the demodulator) */
const faded = (d: SyncDrop) => d.snr_during == null || d.snr_before == null || d.snr_during < Math.max(3, d.snr_before / 2)

/** Where sync was lost over all passes with a saved signal: how many, which kind, how long, in which
    direction, and per elevation band per minute received there. "…" while loading (passes null). */
function Drops({ passes }: { passes: PassSummary[] | null }) {
  const t = useT()
  const loading = passes === null
  const seen = (passes ?? []).filter(p => p.drops != null)
  const drops = seen.flatMap(p => p.drops!)
  const fades = drops.filter(faded).length
  const bands = BANDS.map(band => {
    const minutes = seen.reduce((sum, p) => sum + (p.tracked?.[String(band)] ?? 0), 0) / 60
    const n = drops.filter(d => d.el != null && bandOf(d.el) === band).length
    return { band, n, minutes, rate: minutes > 0 ? n / minutes : null }
  })
  const topRate = Math.max(0, ...bands.map(b => b.rate ?? 0))
  const sectors = new Array(8).fill(0)
  for (const d of drops) if (d.az != null) sectors[Math.round(d.az / 45) % 8]++
  const directions = sectors.flatMap((n, i) => (n ? [`${compass(i * 45)} ${n}`] : [])).join(' · ')
  const lengths = drops.map(d => d.seconds)

  return (
    <>
      <h3 className="subhead">{t('stats.drops')}</h3>
      <dl className="facts">
        <Fact label={t('stats.dropsCount')} loading={loading}
          value={t('stats.dropsValue', { n: drops.length, passes: seen.length, clean: seen.filter(p => p.drops!.length === 0).length })} />
        <Fact label={t('stats.dropsKind')} loading={loading}
          value={<>{t('stats.faded', { n: fades })} · {t('stats.held', { n: drops.length - fades })}</>} />
        <Fact label={t('stats.dropsLength')} loading={loading}
          value={lengths.length ? t('stats.dropsLengthValue', { s: median(lengths)!.toFixed(0) }) : '–'} />
        <Fact label={t('stats.dropsDirection')} loading={loading} value={directions || '–'} />
      </dl>
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr><th>{t('stats.elevation')}</th><th>{t('stats.dropsCol')}</th><th>{t('stats.minutesCol')}</th><th>{t('stats.rateCol')}</th></tr>
          </thead>
          <tbody>
            {bands.map(b => (
              <tr key={b.band}>
                <td>{b.band}–{b.band + 10}°</td>
                {loading ? [0, 1, 2].map(i => <td key={i}>{WAIT}</td>) : <>
                  <td>{b.n}</td>
                  <td>{b.minutes.toFixed(1)}</td>
                  <td>
                    {b.rate == null ? '–' : <>
                      <span className="rate-bar"><span style={{ width: `${topRate ? (b.rate / topRate) * 100 : 0}%` }} /></span>
                      {b.rate.toFixed(2)}
                    </>}
                  </td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t('stats.dropsHint')}</p>
    </>
  )
}
