import portrait from '../assets/eleandre-portrait.jpg'
import { useUI } from '../context'
import { procurementPipeline } from '../data/flagship'
import { profile, specialties } from '../data/profile'
import { familySlug, projects } from '../data/projects'
import { stack } from '../data/stack'

export function Hero() {
  const { openProject } = useUI()

  return (
    <section id="top" className="hero wrap" aria-label="Introduction">
      <div className="bento">
        <div className="bento__cell bento__intro">
          <h1 className="hero__name">
            <span>{profile.firstName}</span>
            <span>{profile.lastName}</span>
          </h1>
          <div className="hero__intro">
            <p className="hero__role">{profile.role}</p>
            <p className="hero__tagline">{profile.tagline}</p>
            <div className="hero__actions">
              <a href="#work" className="button button--solid">
                See my work
              </a>
              <a href={`mailto:${profile.email}`} className="button button--line">
                Email me
              </a>
            </div>
          </div>
        </div>

        <figure className="bento__cell bento__portrait">
          <img src={portrait} alt="Eleandre Sales" width="1024" height="1024" fetchPriority="high" />
        </figure>

        <div className="bento__cell bento__built">
          <h2 className="cell-title">What I’ve built</h2>
          <ul className="built-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" className="built-list__item" data-family={familySlug[p.family]} onClick={() => openProject(p.id)}>
                  <span className="swatch" aria-hidden />
                  {p.name}
                  <span className="built-list__cat">{p.category}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="bento__cell bento__fact bento__fact--keys">
          <p className="fact__figure">~180</p>
          <p className="fact__label">permission capability keys in POSIBLI, with role- and employee-level overrides</p>
        </div>

        <div className="bento__cell bento__fact bento__fact--steps">
          <ol className="ticks" aria-label="InventoNet procurement steps">
            {procurementPipeline.map((s) => (
              <li key={s} title={s} />
            ))}
          </ol>
          <p className="fact__figure">{procurementPipeline.length}</p>
          <p className="fact__label">steps from requisition to returns in InventoNet, my most extensive build</p>
        </div>

        <div className="bento__cell bento__do">
          <h2 className="cell-title">What I do</h2>
          <ul className="do-list">
            {specialties.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>

        <div className="bento__cell bento__tech">
          <h2 className="cell-title">Working across</h2>
          <dl className="tech-strip">
            {stack.map((g) => (
              <div key={g.group}>
                <dt>{g.group}</dt>
                <dd>{g.items.slice(0, 3).join(', ')}</dd>
              </div>
            ))}
          </dl>
          <a href="#stack" className="text-link">
            All tools
          </a>
        </div>
      </div>
    </section>
  )
}
