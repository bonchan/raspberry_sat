import { Link } from 'react-router-dom'
import { api, passFile, type PassSummary } from '../api'
import { usePolling } from '../hooks'
import { longDate, percent, size } from '../format'

export default function Passes() {
  const { data, error } = usePolling(api.getPasses, 15000)

  return (
    <>
      {error && <p className="error">{error}</p>}
      {data && data.in_progress.length > 0 && (
        <section>
          <h2>In progress</h2>
          {data.in_progress.map(p => (
            <p key={p.id} className="hint">
              {p.id}: receiving or decoding. It appears below about 5 minutes after the last file is written.
            </p>
          ))}
        </section>
      )}
      {data && data.passes.length === 0 && (
        <section>
          <h2>Passes</h2>
          <p className="hint">No passes yet. Finished passes show up here a few minutes after the satellite sets.</p>
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
  return (
    <Link className="card" to={`/passes/${encodeURIComponent(pass.id)}`}>
      {pass.main
        ? <img src={passFile(pass.id, 'thumb', pass.main)} alt="" loading="lazy" />
        : <div className="noimage">no images</div>}
      <div className="caption">
        <b>{pass.satellite}</b>
        <span>{longDate(pass.time)}</span>
        <span className="hint">
          {pass.coverage !== null && <>{percent(pass.coverage)} received · </>}
          {pass.image_count} images · {size(pass.size)}
        </span>
      </div>
    </Link>
  )
}
