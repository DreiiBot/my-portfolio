import type { CSSProperties } from 'react'
import type { Diagram as DiagramSpec } from '../data/projects'

export function Diagram({ spec }: { spec: DiagramSpec }) {
  if (spec.kind === 'flow') {
    return (
      <figure className="diagram">
        <figcaption className="diagram__title">{spec.title}</figcaption>
        <ol className="flow">
          {spec.steps.map((s, n) => (
            <li key={s} className="flow__step" style={{ '--i': n } as CSSProperties}>
              <span className="flow__num">{n + 1}</span>
              <span className="flow__label">{s}</span>
            </li>
          ))}
        </ol>
      </figure>
    )
  }

  return (
    <figure className="diagram">
      <figcaption className="diagram__title">{spec.title}</figcaption>
      <div className="tiers">
        {spec.tiers.map((t) => (
          <div key={t.label} className="tiers__row">
            <p className="tiers__label">{t.label}</p>
            <ul className="tiers__nodes">
              {t.nodes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  )
}
