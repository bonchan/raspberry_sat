import { Link } from 'react-router-dom'
import { api, type Status as StatusData, type UpcomingPass } from '../api'
import { useNow, usePolling } from '../hooks'
import { useT } from '../i18n'
import PassCards from '../PassCards'
import UpcomingPasses from '../UpcomingPasses'

/** The home page: the next pass and the upcoming passes. */
export default function Upcoming() {
  const t = useT()
  const { data: status, error } = usePolling(api.getStatus, 2000)
  const { data: config } = usePolling(api.getConfig, 60000)
  const { data: schedule } = usePolling(api.getSchedule, 60000)

  return (
    <>
      {error && <p className="error">{t('status.backendDown', { error })}</p>}
      <NextPass status={status} passes={schedule?.passes ?? []} />
      <UpcomingPasses minElevation={config?.tracking.min_elevation}
        station={config?.stations[config.active_station]?.name}
        showLow={config?.display.show_low_passes ?? true} />
    </>
  )
}

function NextPass({ status, passes }: { status: StatusData | null; passes: UpcomingPass[] }) {
  const t = useT()
  const now = useNow()
  const tr = status?.tracker?.object_tracker
  const receiving = status?.receiving ?? false
  const overhead = (status?.overhead ?? false) && tr !== undefined

  const stale = status?.tracker_age != null && status.tracker_age > 10
  // SatDump's tracker follows every pass of the satellite; low ones are skipped, nothing is received
  const skipped = overhead && !receiving
  const title = receiving ? t('status.receivingNow')
    : skipped ? t('status.overheadNotRecorded') : t('status.nextPass')
  // During a pass: the one going on, from SatDump's tracker. Otherwise: the next pass SatDump will record,
  // from the schedule. The tracker's own "next pass" may be one too low to record.
  const next = passes.find(p => p.scheduled && p.aos > now)
  const pass = overhead && tr
    ? { name: tr.object_name, aos: tr.next_aos_time, los: tr.next_los_time }
    : next && { name: next.name, aos: next.aos, los: next.los }
  const showPosition = overhead && tr && tr.sat_current_pos.el > 0

  return (
    <section>
      <h2>{title}{pass && ` · ${pass.name}`}</h2>
      {!pass && <p className="hint">{t('status.noPass')}</p>}
      {pass && <PassCards aos={pass.aos} los={pass.los} inPass={overhead} />}
      {(showPosition || receiving) && tr && (
        <dl className="facts">
          {showPosition && <>
            <dt>{t('status.position')}</dt>
            <dd>az {tr.sat_current_pos.az.toFixed(1)}°, el {tr.sat_current_pos.el.toFixed(1)}°
              {tr.sat_current_range !== undefined && `, ${Math.round(tr.sat_current_range)} km`}</dd>
          </>}
          {receiving && status?.tracker &&
            <><dt>{t('status.tunedTo')}</dt><dd>{(status.tracker.frequency / 1e6).toFixed(3)} MHz</dd></>}
        </dl>
      )}
      {skipped && <p className="hint">{t('status.skippedHint')}</p>}
      {stale && <p className="hint">{t('status.stale', { s: Math.round(status!.tracker_age!) })}</p>}
      {receiving && <p><Link to="/live">{t('status.watchLive')}</Link></p>}
    </section>
  )
}
