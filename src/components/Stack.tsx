import { useEffect, useState } from 'react'
import { useUI } from '../context'
import { familySlug, projects } from '../data/projects'
import { techByName, techGroups } from '../data/techIndex'

export function Stack() {
  const { openProject } = useUI()
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const tool = hovered ?? pinned
  const used = new Set(tool ? techByName.get(tool) : [])

  // The command menu can jump here with a tool already chosen.
  useEffect(() => {
    const onSelect = (e: Event) => setPinned((e as CustomEvent<string>).detail)
    window.addEventListener('select-tool', onSelect)
    return () => window.removeEventListener('select-tool', onSelect)
  }, [])

  return (
    <section id="stack" className="stack">
      <div className="wrap">
        <header className="section-head">
          <h2 className="section-title">Tools I use</h2>
          <p className="section-lead">Grouped by the kind of work. Everything here is used in one of the systems above.</p>
        </header>

        <div className="stack__body">
          <div className="stack__groups" onMouseLeave={() => setHovered(null)}>
            {techGroups.map((g) => (
              <div key={g.group} className="stack__group">
                <h3 className="stack__group-name">{g.group}</h3>
                <ul className="chips">
                  {g.items.map((t) => (
                    <li key={t.name}>
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={pinned === t.name}
                        data-linked={t.projects.length > 0}
                        onMouseEnter={() => setHovered(t.name)}
                        onFocus={() => setHovered(t.name)}
                        onBlur={() => setHovered(null)}
                        onClick={() => setPinned((v) => (v === t.name ? null : t.name))}
                      >
                        {t.name}
                        {t.projects.length > 0 && <span className="chip__count">{t.projects.length}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <aside className="rail" aria-live="polite" data-active={tool !== null}>
            <p className="rail__title">
              {tool ? (
                used.size ? (
                  <>
                    <strong>{tool}</strong> appears in {used.size} {used.size === 1 ? 'system' : 'systems'}
                  </>
                ) : (
                  <>
                    <strong>{tool}</strong> isn’t called out in a single project write-up
                  </>
                )
              ) : (
                'Point at a tool to see where it’s used'
              )}
            </p>
            <ul className="rail__list">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="rail__item"
                    data-family={familySlug[p.family]}
                    data-state={tool === null ? undefined : used.has(p.id) ? 'on' : 'off'}
                    onClick={() => openProject(p.id)}
                  >
                    <span className="swatch" aria-hidden />
                    <span className="rail__name">{p.name}</span>
                    <span className="rail__cat">{p.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </section>
  )
}
