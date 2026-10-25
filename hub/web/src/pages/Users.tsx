import { useCallback, useEffect, useState } from 'react'
import { api, type Me, type Role, type User } from '../api'
import { ago, longDate } from '../format'

const ROLE_TEXT: Record<Role, string> = {
  admin: 'admin: sees everything, manages stations and users',
  viewer: 'viewer: sees the passes',
  pending: 'pending: sees nothing until you choose',
}

/** Admins: everyone who signed in with Google, and what they may do. */
export default function Users({ me }: { me: Me }) {
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
    if (!confirm(`Remove ${u.email}? They are signed out; if they sign in again they wait as pending.`)) return
    change(() => api.removeUser(u.sub))
  }

  return (
    <section>
      <h2>Users</h2>
      <p className="hint">
        Anyone with a Google account can sign in; they wait as <b>pending</b> until you give them a role. To keep
        someone out, leave them pending.
      </p>
      {error && <p className="error">{error}</p>}
      {users === null && !error && <p className="hint">Loading…</p>}
      {users && (
        <div className="table-scroll">
          <table className="stats-table">
            <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>First sign-in</th><th /></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.sub}>
                  <td>{u.name && <b>{u.name} </b>}<span className="hint">{u.email}</span>{u.sub === me.sub && ' (you)'}</td>
                  <td>
                    <select value={u.role} title={ROLE_TEXT[u.role]} onChange={e => setRole(u, e.target.value as Role)}>
                      <option value="admin">admin</option>
                      <option value="viewer">viewer</option>
                      <option value="pending">pending</option>
                    </select>
                  </td>
                  <td>{ago(u.last_login)}</td>
                  <td>{longDate(u.created_at)}</td>
                  <td><div className="actions"><button className="danger" onClick={() => remove(u)}>Remove</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="hint">
        {(Object.keys(ROLE_TEXT) as Role[]).map(r => <li key={r}>{ROLE_TEXT[r]}</li>)}
      </ul>
    </section>
  )
}
