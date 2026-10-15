import { useNow } from './hooks'
import { clock, duration, sameDay, utcClock, weekdayShort } from './format'
import { useT } from './i18n'

/** Start, end, and a big countdown: to the start, or to the end while the pass is on (`inPass`). */
export default function PassCards({ aos, los, inPass }: { aos: number; los: number; inPass: boolean }) {
  const t = useT()
  const now = useNow()
  // "Today", or the weekday, next to a time
  const day = (unix: number) => sameDay(unix, now) ? t('up.today') : weekdayShort(unix)
  return (
    <div className="pass-cards">
      <div className="tile">
        <small>{t('status.starts')}</small>
        <b>{clock(aos)}</b>
        <small>{day(aos)} · {utcClock(aos)} UTC</small>
      </div>
      <div className="tile">
        <small>{t('status.ends')}</small>
        <b>{clock(los)}</b>
        <small>{day(los)} · {utcClock(los)} UTC</small>
      </div>
      <div className={inPass ? 'tile countdown now' : 'tile countdown'}>
        <small>{inPass ? t('status.endsIn') : t('status.startsIn')}</small>
        <b>{duration((inPass ? los : aos) - now)}</b>
      </div>
    </div>
  )
}
