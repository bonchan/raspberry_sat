// Small form inputs bound to a value + setter, so the settings page stays declarative.

import { useEffect, useState } from 'react'

interface Base { label: string; hint?: string }

// secret: shown as dots, for tokens
export function TextField({ label, hint, value, onChange, placeholder, secret }:
  Base & { value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={secret ? 'password' : 'text'} autoComplete={secret ? 'off' : undefined} value={value}
        placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

const splitList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

// a comma separated list; the box keeps what is typed (a trailing comma too) and follows outside changes (Discard)
export function ListField({ label, hint, value, onChange }:
  Base & { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => {
    if (JSON.stringify(splitList(text)) !== JSON.stringify(value)) setText(value.join(', '))
  }, [value])
  return <TextField label={label} hint={hint} value={text} onChange={v => { setText(v); onChange(splitList(v)) }} />
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

export function SelectField<T extends string>({ label, hint, value, options, onChange }:
  Base & { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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
