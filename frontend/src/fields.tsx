// Small form inputs bound to a value + setter, so the settings page stays declarative.

interface Base { label: string; hint?: string }

export function TextField({ label, hint, value, onChange, placeholder }:
  Base & { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

// an emptied box sends NaN, which the backend rejects with a readable error
export function NumberField({ label, hint, value, onChange, step = 'any' }:
  Base & { value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={Number.isNaN(value) ? '' : value}
        onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function CheckField({ label, hint, value, onChange }:
  Base & { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field check">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </label>
  )
}
