import { useCallback, useEffect, useState } from 'react'
import { api, type Me, type Role, type User } from '../api'
import { ago, longDate } from '../format'
import { useT } from '../i18n'

const ROLES: Role[] = ['admin', 'viewer', 'pending']

/** Admins: everyone who signed in with Google, and what they may do. */
export default function Users({ me }: { me: Me }) {
  const t = useT()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api.users().then(setUsers, e => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  async function change(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  const setRole = (u: User, role: Role) => change(() => api.setRole(u.sub, role))
  const remove = (u: User) => {
    if (!confirm(t('users.confirmRemove', { email: u.email }))) return
    change(() => api.removeUser(u.sub))
  }

  return (
    <section>
      <h2>{t('users.title')}</h2>
      <p className="hint">{t('users.hint')}</p>
      {error && <p className="error">{error}</p>}
      {users === null && !error && <p className="hint">{t('common.loading')}</p>}
      {users && (
        <div className="table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th>{t('users.user')}</th><th>{t('users.role')}</th><th>{t('users.lastLogin')}</th>
                <th>{t('users.firstLogin')}</th><th />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.sub}>
                  <td>
                    {u.name && <b>{u.name} </b>}<span className="hint">{u.email}</span>
                    {u.sub === me.sub && <> {t('users.you')}</>}
                  </td>
                  <td>
                    <select value={u.role} title={t(`roleText.${u.role}`)} onChange={e => setRole(u, e.target.value as Role)}>
                      {ROLES.map(r => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                  </td>
                  <td>{ago(u.last_login)}</td>
                  <td>{longDate(u.created_at)}</td>
                  <td>
                    <div className="actions"><button className="danger" onClick={() => remove(u)}>{t('users.remove')}</button></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="hint">
        {ROLES.map(r => <li key={r}>{t(`roleText.${r}`)}</li>)}
      </ul>
    </section>
  )
}
