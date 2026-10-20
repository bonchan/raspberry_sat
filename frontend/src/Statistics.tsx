// Station statistics on the Status page, worked out here from the pass list: how often reception works,
// the elevations at which it starts and ends, and how pass quality (by highest elevation) turns out.

import { api, type PassSummary } from './api'
import { usePolling } from './hooks'
import { longDate, percent, size } from './format'
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

  if (!data || data.passes.length === 0) {
    return (
      <section>
        <h2>{t('stats.title')}</h2>
        {error ? <p className="error">{error}</p> : <p className="hint">{data ? t('stats.none') : t('common.loading')}</p>}
      </section>
    )
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
  const dash = '–'

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
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th>{t('stats.quality')}</th><th>{t('stats.count')}</th><th>{t('stats.syncedCol')}</th>
              <th>{t('stats.lockCol')}</th><th>{t('stats.receivedCol')}</th><th>{t('stats.snrCol')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.quality}>
                <td>
                  <span className={`swatch q-${g.quality}`} />{t(`quality.${g.quality}` as Key)}{' '}
                  <span className="hint">{RANGES[g.quality]}</span>
                </td>
                <td>{g.count}</td>
                <td>{g.synced == null ? dash : percent(g.synced)}</td>
                <td>{g.lock == null ? dash : percent(g.lock)}</td>
                <td>{g.received == null ? dash : percent(g.received)}</td>
                <td>{g.snr == null ? dash : `${g.snr.toFixed(1)} dB`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t('stats.byQualityHint')}</p>
    </section>
  )
}
