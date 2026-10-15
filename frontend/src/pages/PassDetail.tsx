import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, passFile, type PassDetail as Pass, type PassImage } from '../api'
import { longDate, percent, size, utc } from '../format'

// which variant of a composite to show first
const VARIANT_ORDER = ['corrected,map', 'corrected', 'map', '']

const variantLabel = (v: string[]) => v.length ? v.join(' + ') : 'raw'

interface Group { key: string; instrument: string; name: string; images: PassImage[] }

function groupImages(images: PassImage[], main: string | null): Group[] {
  const groups = new Map<string, Group>()
  for (const img of images) {
    const key = `${img.instrument}|${img.name}`
    if (!groups.has(key)) groups.set(key, { key, instrument: img.instrument, name: img.name, images: [] })
    groups.get(key)!.images.push(img)
  }
  const rank = (i: PassImage) => {
    const r = VARIANT_ORDER.indexOf(i.variants.join(','))
    return r < 0 ? VARIANT_ORDER.length : r
  }
  const list = [...groups.values()]
  for (const g of list) g.images.sort((a, b) => rank(a) - rank(b))
  // the main image's composite first, then by name
  const hasMain = (g: Group) => g.images.some(i => i.path === main)
  return list.sort((a, b) =>
    Number(hasMain(b)) - Number(hasMain(a)) || a.name.localeCompare(b.name))
}

export default function PassDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [pass, setPass] = useState<Pass | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<PassImage | null>(null)

  useEffect(() => {
    api.getPass(id).then(setPass, e => setError(String(e.message)))
  }, [id])

  const groups = useMemo(() => pass ? groupImages(pass.images, pass.main) : [], [pass])

  if (error) return <section><p className="error">{error}</p><Link to="/passes">Back to passes</Link></section>
  if (!pass) return <section><p className="hint">Loading…</p></section>

  async function remove() {
    if (!pass || !confirm(`Delete this pass and all its files (${size(pass.size)})? This cannot be undone.`)) return
    try {
      await api.deletePass(pass.id)
      navigate('/passes')
    } catch (e) {
      setError(String(e))
    }
  }

  const main = pass.images.find(i => i.path === pass.main)

  return (
    <>
      <section>
        <p><Link to="/passes">← All passes</Link></p>
        <h2>{pass.satellite}</h2>
        <dl className="facts">
          <dt>Time</dt><dd>{longDate(pass.time)} ({utc(pass.time)})</dd>
          {pass.coverage !== null && <><dt>Received</dt><dd>{percent(pass.coverage)} of the main image</dd></>}
          <dt>Images</dt><dd>{pass.images.length}</dd>
          <dt>Size</dt><dd>{size(pass.size)}</dd>
          <dt>Folder</dt><dd>{pass.id}{pass.source_name !== pass.id && <span className="hint"> (was {pass.source_name})</span>}</dd>
        </dl>
        {main && (
          <img className="hero" src={passFile(pass.id, 'large', main.path)} alt={main.name}
            onClick={() => setOpen(main)} />
        )}
      </section>

      {groups.length > 0 && (
        <section>
          <h2>Images</h2>
          <div className="gallery">
            {groups.map(g => <GroupCard key={g.key} passId={pass.id} group={g} onOpen={setOpen} />)}
          </div>
        </section>
      )}

      <section>
        <h2>Files</h2>
        <ul className="files">
          {pass.files.map(f => (
            <li key={f.path}><a href={passFile(pass.id, 'file', f.path)}>{f.path}</a> <span className="hint">{size(f.bytes)}</span></li>
          ))}
        </ul>
        <button className="danger" onClick={remove}>Delete pass</button>
      </section>

      {open && <Lightbox passId={pass.id} image={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function GroupCard({ passId, group, onOpen }: { passId: string; group: Group; onOpen: (i: PassImage) => void }) {
  const [shown, setShown] = useState(group.images[0])
  return (
    <div className="card">
      {shown.error
        ? <div className="noimage">could not read this image</div>
        : <img src={passFile(passId, 'thumb', shown.path)} alt={group.name} loading="lazy" onClick={() => onOpen(shown)} />}
      <div className="caption">
        <b>{group.name}</b>
        {group.images.length > 1 && (
          <div className="chips">
            {group.images.map(i => (
              <button key={i.path} className={i === shown ? 'chip on' : 'chip'} onClick={() => setShown(i)}>
                {variantLabel(i.variants)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Lightbox({ passId, image, onClose }: { passId: string; image: PassImage; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={passFile(passId, 'large', image.path)} alt={image.name} />
      <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
        <span>{image.name} · {variantLabel(image.variants)}</span>
        <a href={passFile(passId, 'file', image.path)} target="_blank" rel="noreferrer">
          Original ({image.width}×{image.height}, {size(image.bytes)})
        </a>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
