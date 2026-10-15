export default function Placeholder({ title, step }: { title: string; step: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p className="hint">Coming in build step {step} (see docs/PLAN.md).</p>
    </section>
  )
}
