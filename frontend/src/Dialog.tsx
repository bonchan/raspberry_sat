import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useT } from './i18n'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string     // what the action button says; "Confirm" when left out
  danger?: boolean          // red button, and Cancel takes the focus so Enter does not run it
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask>(async () => false)

/** `if (!(await ask({ title, message, danger: true }))) return` — the page's own confirmation dialog. */
export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

  const ask = useCallback<Ask>(options => new Promise(resolve => setRequest({ ...options, resolve })), [])

  const close = useCallback((ok: boolean) => {
    setRequest(current => {
      current?.resolve(ok)
      return null
    })
  }, [])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, close])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <div className="dialog-backdrop" onClick={() => close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title"
            onClick={e => e.stopPropagation()}>
            <h3 id="dialog-title">{request.title}</h3>
            <p>{request.message}</p>
            <div className="dialog-buttons">
              <button autoFocus={request.danger} onClick={() => close(false)}>{t('dialog.cancel')}</button>
              <button autoFocus={!request.danger} className={request.danger ? 'danger solid' : 'primary'}
                onClick={() => close(true)}>
                {request.confirmLabel ?? t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
