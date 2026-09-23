import { useEffect, useRef, useState } from 'react'
import { familySlug, getProject, projects } from '../data/projects'
import { Diagram } from './Diagram'
import { Chevron, Close } from './Icons'
import { Plate } from './Plate'

interface Props {
  id: string | null
  onChange: (id: string | null) => void
}

export function ProjectSheet({ id, onChange }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Remembers which project had its extra detail open, so switching projects collapses it.
  const [moreFor, setMoreFor] = useState<string | null>(null)
  const project = id ? getProject(id) : undefined
  const showMore = project !== undefined && moreFor === project.id

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (project && !dialog.open) {
      dialog.showModal()
      document.documentElement.classList.add('is-locked')
    }
    if (!project) {
      document.documentElement.classList.remove('is-locked')
      if (dialog.open) dialog.close()
    }
  }, [project])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [id])

  if (!project) {
    return <dialog ref={ref} className="sheet" onClose={() => onChange(null)} />
  }

  const index = projects.findIndex((p) => p.id === project.id)
  const prev = projects[(index - 1 + projects.length) % projects.length]
  const next = projects[(index + 1) % projects.length]

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      data-family={familySlug[project.family]}
      onClose={() => onChange(null)}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="sheet__panel" ref={scrollRef}>
        <div className="sheet__bar">
          <p className="card__meta">
            <span className="family-tag">
              <span className="swatch" aria-hidden />
              {project.family}
            </span>
            <span>{project.category}</span>
          </p>
          <div className="sheet__controls">
            <button type="button" className="icon-button" onClick={() => onChange(prev.id)} aria-label={`Previous: ${prev.name}`}>
              <Chevron dir="left" />
            </button>
            <button type="button" className="icon-button" onClick={() => onChange(next.id)} aria-label={`Next: ${next.name}`}>
              <Chevron />
            </button>
            <button type="button" className="icon-button" onClick={() => ref.current?.close()} aria-label="Close project">
              <Close />
            </button>
          </div>
        </div>

        <div key={project.id} className="sheet__content">
          <header className="sheet__head">
            <h2 id="sheet-title" className="sheet__name">
              {project.name}
            </h2>
            <div className="sheet__intro">
              <p className="sheet__summary">{project.summary}</p>
              {project.lead && <p className="sheet__lead">{project.lead}</p>}
              {project.meta && <p className="sheet__meta">{project.meta}</p>}
            </div>
          </header>

          <div className="sheet__visual">
            <Plate project={project} live />
          </div>

          <div className="sheet__body">
            <aside className="sheet__aside">
              <h3 className="sheet__label">Technology</h3>
              <ul className="tags tags--stacked">
                {project.tech.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </aside>

            <div className="sheet__main">
              <section>
                <h3 className="sheet__label">Capabilities</h3>
                <div className="capabilities">
                  {project.sections.map((s) => (
                    <div key={s.title} className="capability">
                      {s.kicker && <p className="capability__kicker">{s.kicker}</p>}
                      <h4 className="capability__title">{s.title}</h4>
                      {s.body && <p className="capability__body">{s.body}</p>}
                      {s.items && (
                        <ul className="capability__list" data-inline={s.items.length > 6}>
                          {s.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>

                {project.more && (
                  <>
                    <button
                      type="button"
                      className="disclosure"
                      aria-expanded={showMore}
                      aria-controls="sheet-more"
                      onClick={() => setMoreFor(showMore ? null : project.id)}
                    >
                      {showMore ? `Hide ${project.more.label}` : `Show ${project.more.label}`}
                    </button>
                    <div id="sheet-more" className="collapse" data-open={showMore}>
                      <div className="collapse__inner">
                        <div className="capabilities capabilities--more">
                          {project.more.sections.map((s) => (
                            <div key={s.title} className="capability">
                              <h4 className="capability__title">{s.title}</h4>
                              <ul className="capability__list">
                                {s.items?.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>

              {project.diagrams && project.diagrams.length > 0 && (
                <section>
                  <h3 className="sheet__label">Architecture and integrations</h3>
                  <div className="diagrams">
                    {project.diagrams.map((d) => (
                      <Diagram key={d.title} spec={d} />
                    ))}
                  </div>
                </section>
              )}

              {project.note && <p className="sheet__note">{project.note}</p>}
            </div>
          </div>

          <button type="button" className="sheet__next" onClick={() => onChange(next.id)}>
            <span className="sheet__next-label">Next system</span>
            <span className="sheet__next-name">{next.name}</span>
          </button>
        </div>
      </div>
    </dialog>
  )
}
