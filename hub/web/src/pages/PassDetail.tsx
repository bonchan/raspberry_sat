import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Me, type PassDetail as Pass, type SignalThumb } from '../api'
import { useT } from '../i18n'
import PassView from '../PassView'

/** One pass: all of it for viewers and admins (admins can delete it); signed out, what everyone sees. */
export default function PassDetail({ me }: { me: Me | null }) {
  const t = useT()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [pass, setPass] = useState<Pass | null>(null)
  const [error, setError] = useState('')
  const [chart, setChart] = useState<SignalThumb | null>(null)
  const admin = me?.role === 'admin'
  const all = admin || me?.role === 'viewer'

  useEffect(() => {
    let alive = true
    setChart(null)
    api.pass(id).then(p => {
      if (!alive) return
      setPass(p)
      if (p.signal) api.signal(id).then(s => alive && setChart(s), () => {})
    }, e => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  async function remove() {
    if (!pass || !confirm(t('detail.confirmDelete', { receiver: pass.receiver.name }))) return
    try {
      await api.deletePass(pass.id)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <section><p className="error">{error}</p><Link to="/">{t('common.allPasses')}</Link></section>
  if (!pass) return <section><p className="hint">{t('common.loading')}</p></section>

  // what more there is, and how to see it
  const note = all ? null : me
    ? <p className="hint">{t('waiting.short')}</p>
    : <p className="hint"><Link to="/signin">{t('public.link')}</Link> {t('public.more')}</p>
  return <PassView pass={pass} chart={chart} note={note} onDelete={admin ? remove : undefined} />
}
