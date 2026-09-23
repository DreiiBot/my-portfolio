import { useState } from 'react'
import type { CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { useUI } from '../context'
import { families, familySlug, projects } from '../data/projects'
import type { Family, Project } from '../data/projects'
import { EcosystemMap } from './EcosystemMap'
import { Expand } from './Icons'
import { Plate } from './Plate'

type Filter = 'All' | Family

// Gallery order for "All": the flagship first, then pairs of uneven widths.
const allOrder = [
  'posibli',
  'inventonet',
  'invoicing',
  'picklebook',
  'yuaskme',
  'synapsego',
  'orange-portal',
  'vistay',
  'neuronest',
  'tally-room',
  'posibli-kiosk-admin',
]
const pairs = [
  [7, 5],
  [5, 7],
  [6, 6],
]

function layout(list: Project[]) {
  const spans = new Map<string, number>()
  const rest = list.filter((p) => !p.flagship)
  list.filter((p) => p.flagship).forEach((p) => spans.set(p.id, 12))
  rest.forEach((p, n) => {
    const isLoneLast = n === rest.length - 1 && n % 2 === 0
    spans.set(p.id, isLoneLast ? 12 : pairs[Math.floor(n / 2) % pairs.length][n % 2])
  })
  return spans
}

function ProjectCard({ project, span }: { project: Project; span: number }) {
  const { openProject } = useUI()
  const shape = project.flagship ? 'flagship' : span === 12 ? 'wide' : span >= 7 ? 'large' : 'compact'
  const shownTech = project.tech.slice(0, 5)

  return (
    <article
      className="card"
      data-shape={shape}
      data-family={familySlug[project.family]}
      style={{ gridColumn: `span ${span}`, viewTransitionName: `card-${project.id}` } as CSSProperties}
    >
      <div className="card__media">
        <Plate project={project} />
        <span className="card__open" aria-hidden>
          <Expand />
        </span>
      </div>
      <div className="card__text">
        <p className="card__meta">
          <span className="family-tag">
            <span className="swatch" aria-hidden />
            {project.family}
          </span>
          <span>{project.category}</span>
        </p>
        <h3 className="card__name">
          <button type="button" className="card__hit" onClick={() => openProject(project.id)}>
            {project.name}
          </button>
        </h3>
        <p className="card__summary">{project.summary}</p>
        {project.flagship && project.lead && <p className="card__lead">{project.lead}</p>}
        <ul className="tags" aria-label="Technology">
          {shownTech.map((t) => (
            <li key={t}>{t}</li>
          ))}
          {project.tech.length > shownTech.length && <li className="tags__more">+{project.tech.length - shownTech.length}</li>}
        </ul>
      </div>
    </article>
  )
}

export function Work() {
  const [filter, setFilter] = useState<Filter>('All')

  const ordered = allOrder.map((id) => projects.find((p) => p.id === id)!)
  const visible = filter === 'All' ? ordered : ordered.filter((p) => p.family === filter)
  const spans = layout(visible)
  const blurb = families.find((f) => f.name === filter)?.blurb

  const choose = (f: Filter) => {
    if (f === filter) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!document.startViewTransition || reduce) return setFilter(f)
    document.startViewTransition(() => flushSync(() => setFilter(f)))
  }

  const options: { name: Filter; count: number }[] = [{ name: 'All', count: projects.length }, ...families]

  return (
    <section id="work" className="work">
      <div className="wrap">
        <header className="section-head">
          <h2 className="section-title">Work</h2>
          <p className="section-lead">
            POSIBLI sits at the centre, but it isn’t alone. These are the other platforms I’ve built, grouped by where they
            live in the ecosystem.
          </p>
        </header>

        <div className="explorer" role="group" aria-label="Filter projects">
          <div className="explorer__options">
            {options.map((o) => (
              <button
                key={o.name}
                type="button"
                className="explorer__option"
                aria-pressed={filter === o.name}
                data-family={o.name === 'All' ? undefined : familySlug[o.name]}
                onClick={() => choose(o.name)}
              >
                {o.name !== 'All' && <span className="swatch" aria-hidden />}
                {o.name}
                <span className="explorer__count">{o.count}</span>
              </button>
            ))}
          </div>
          <p className="explorer__blurb" aria-live="polite">
            {blurb ?? 'Every system in the portfolio'}
          </p>
        </div>

        <div className="gallery">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} span={spans.get(p.id) ?? 6} />
          ))}
        </div>
      </div>

      <EcosystemMap />
    </section>
  )
}
