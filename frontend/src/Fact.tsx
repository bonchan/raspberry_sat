// A row of a facts list (<dl className="facts">) that keeps its place while loading, so the page
// doesn't move when the values arrive and push buttons out from under the pointer.

import type { ReactNode } from 'react'

export const WAIT = <span className="hint">…</span>

/** "…" until the first answer; left out once the answer has nothing for it (off the Pi, no data). */
export default function Fact({ label, loading, value }: {
  label: string; loading: boolean; value: ReactNode | null | undefined | false
}) {
  if (!loading && (value === null || value === undefined || value === false)) return null
  return <><dt>{label}</dt><dd>{loading ? WAIT : value}</dd></>
}
