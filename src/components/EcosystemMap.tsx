import { useState } from 'react'
import { useUI } from '../context'
import { externals, familySlug, getProject, links } from '../data/projects'

// Positions on a 1200 × 640 canvas, grouped by family.
const pos: Record<string, [number, number]> = {
  posibli: [600, 330],
  inventonet: [420, 200],
  invoicing: [780, 200],
  'posibli-kiosk-admin': [600, 500],
  synapsego: [300, 380],
  picklebook: [170, 210],
  'orange-portal': [170, 560],
  yuaskme: [880, 450],
  neuronest: [1060, 540],
  vistay: [960, 260],
  'tally-room': [1060, 110],
  loyverse: [600, 90],
  access: [170, 70],
  paymongo: [50, 385],
  ruijie: [400, 600],
  nx: [1060, 620],
}

const W = 1200
const H = 640

type Edge = { from: string; to: string; label: string; external?: boolean }

const edges: Edge[] = [
  ...links,
  ...externals.flatMap((e) => e.to.map((to) => ({ from: e.id, to, label: `Integrates with ${e.label}`, external: true }))),
]

export function EcosystemMap() {
  const { openProject } = useUI()
  const [active, setActive] = useState<string | null>(null)

  const touches = (e: Edge) => active !== null && (e.from === active || e.to === active)
  const neighbours = new Set(edges.filter(touches).flatMap((e) => [e.from, e.to]))
  const activeEdges = edges.filter(touches)

  const nodeState = (id: string) => (active === null ? undefined : id === active ? 'active' : neighbours.has(id) ? 'near' : 'far')
  const name = (id: string) => getProject(id)?.name ?? externals.find((x) => x.id === id)?.label ?? id

  return (
    <div className="eco">
      <div className="wrap">
        <header className="eco__head">
          <h2 className="eco__title">How the systems connect</h2>
          <p className="eco__lead">
            Every line is a connection described in the project notes. Select a system to open it.
          </p>
        </header>

        <div className="eco__canvas" onMouseLeave={() => setActive(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
            {edges.map((e) => {
              const [x1, y1] = pos[e.from]
              const [x2, y2] = pos[e.to]
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className="eco__edge"
                  data-external={e.external}
                  data-state={active === null ? undefined : touches(e) ? 'on' : 'off'}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>

          {externals.map((x) => (
            <span
              key={x.id}
              className="eco__ext"
              data-state={nodeState(x.id)}
              style={{ left: `${(pos[x.id][0] / W) * 100}%`, top: `${(pos[x.id][1] / H) * 100}%` }}
              onMouseEnter={() => setActive(x.id)}
            >
              {x.label}
            </span>
          ))}

          {Object.keys(pos)
            .filter((id) => getProject(id))
            .map((id) => {
              const p = getProject(id)!
              return (
                <button
                  key={id}
                  type="button"
                  className="eco__node"
                  data-family={familySlug[p.family]}
                  data-flagship={p.flagship}
                  data-state={nodeState(id)}
                  style={{ left: `${(pos[id][0] / W) * 100}%`, top: `${(pos[id][1] / H) * 100}%` }}
                  onMouseEnter={() => setActive(id)}
                  onFocus={() => setActive(id)}
                  onBlur={() => setActive(null)}
                  onClick={() => openProject(id)}
                >
                  <span className="swatch" aria-hidden />
                  {p.name}
                </button>
              )
            })}
        </div>

        <div className="eco__readout" aria-live="polite">
          {active ? (
            <>
              <p className="eco__readout-name">{name(active)}</p>
              {activeEdges.length ? (
                <ul>
                  {activeEdges.map((e) => (
                    <li key={`${e.from}-${e.to}`}>
                      <span>{name(e.from === active ? e.to : e.from)}</span>
                      {e.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="eco__readout-empty">Stands on its own</p>
              )}
            </>
          ) : (
            <p className="eco__readout-empty">Point at a system to see what it connects to.</p>
          )}
        </div>

        {/* Small screens get the same relationships as a list */}
        <ul className="eco__list">
          {links.map((l) => (
            <li key={`${l.from}-${l.to}`}>
              <button type="button" onClick={() => openProject(l.from)}>
                {name(l.from)}
              </button>
              <span className="eco__list-arrow" aria-hidden />
              <button type="button" onClick={() => openProject(l.to)}>
                {name(l.to)}
              </button>
              <p>{l.label}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
