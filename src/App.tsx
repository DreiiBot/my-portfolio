import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import avatar from './assets/photos/avatar.webp'
import bench from './assets/photos/bench.webp'
import denimFront from './assets/photos/denim-front.webp'
import denimSide from './assets/photos/denim-side.webp'
import forestRoad from './assets/photos/forest-road.webp'
import forestWalk from './assets/photos/forest-walk.webp'
import heroCutout from './assets/photos/hero-cutout.webp'
import night from './assets/photos/night.webp'
import palmFront from './assets/photos/palm-front.webp'
import palmSide from './assets/photos/palm-side.webp'
import orangePortalSite from './assets/photos/orange-portal-site.webp'
import picklebookSchedule from './assets/photos/picklebook-app-schedule.webp'
import picklebookSite from './assets/photos/picklebook-site.webp'
import posibliSite from './assets/photos/posibli-site.webp'
import synapsegoHome from './assets/photos/synapsego-app-home.webp'
import synapsegoSite from './assets/photos/synapsego-site.webp'
import vistaySite from './assets/photos/vistay-site.webp'
import yuaskmeSite from './assets/photos/yuaskme-site.webp'
import turtleneck from './assets/photos/turtleneck.webp'
import walkway from './assets/photos/walkway.webp'
import { achievements, families, focus, interview, person, systemCount, tools } from './content'
import type { System } from './content'

const allSystems = families.flatMap((f) => f.systems)
const byId = (id: string) => allSystems.find((s) => s.id === id)!
// Screenshots of each product's website, shown on the tiles that cross "What I do".
const tiles = [
  { system: byId('posibli'), shot: posibliSite },
  { system: byId('orange-portal'), shot: orangePortalSite },
  { system: byId('yuaskme'), shot: yuaskmeSite },
  { system: byId('vistay'), shot: vistaySite },
  { system: byId('picklebook'), shot: picklebookSite },
  { system: byId('synapsego'), shot: synapsegoSite },
]
// Each case study shows the product's website, with a phone screen from the app where there is one.
const featured = [
  { system: byId('posibli'), shot: posibliSite },
  { system: byId('picklebook'), shot: picklebookSite, phone: picklebookSchedule },
  { system: byId('synapsego'), shot: synapsegoSite, phone: synapsegoHome },
]
const shipped = [achievements[1], achievements[2], achievements[3]]
// The strip of photos in About, and the ones scattered around "Let's build something together".
const strip = [forestWalk, palmSide, bench, denimSide, forestRoad, turtleneck, walkway, palmFront]
const scattered = [walkway, palmSide, bench, forestWalk, denimSide]

const nav = [
  { href: '#work', label: 'Work' },
  { href: '#about', label: 'About' },
  { href: '#archive', label: 'Systems' },
]

// Oversized words, one span per letter so each can rise and sink on its own.
function Word({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="ch" style={{ '--i': i, '--d': `${delay + i * 45}ms` } as CSSProperties}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </>
  )
}

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 6v80M14 52l36 36 36-36" fill="none" stroke="currentColor" strokeWidth="11" />
    </svg>
  )
}

export default function App() {
  const [copied, setCopied] = useState(false)

  // The big words sink back into their lines as their section scrolls away.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-sink]'))
    const update = () => {
      const vh = window.innerHeight
      for (const b of blocks) {
        const r = b.getBoundingClientRect()
        const past = reduced.matches ? 0 : Math.min(1, Math.max(0, -r.top / (r.height || vh)))
        b.style.setProperty('--sink', String(Math.round(past * 1000) / 10))
      }
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // A link to a system opens its details before the browser scrolls to it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a[href^="#"]')
      const el = a && document.getElementById(a.getAttribute('href')!.slice(1))
      if (el instanceof HTMLDetailsElement) el.open = true
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(person.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.location.href = `mailto:${person.email}`
    }
  }

  return (
    <>
      <a className="skip" href="#what">
        Skip to content
      </a>

      <nav className="dock" aria-label="Sections">
        <ul>
          {nav.map((n) => (
            <li key={n.href}>
              <a href={n.href}>{n.label}</a>
            </li>
          ))}
        </ul>
        <a className="talk" href="#contact">
          <img src={avatar} alt="" width="28" height="28" />
          Let’s talk
        </a>
      </nav>

      <main>
        {/* Hero ------------------------------------------------------------ */}
        <header className="hero" id="top" data-sink>
          <img
            className="hero-photo"
            src={heroCutout}
            alt="Eleandre Sales in a black suit and round sunglasses, adjusting his tie"
            width="1080"
            height="1935"
          />
          <div className="hero-shade" aria-hidden="true" />

          <a href="#top" className="logo" aria-label={`${person.name}, back to top`}>
            <span>{person.first}</span>
            <span>{person.last}</span>
          </a>
          <a className="hero-mail" href={`mailto:${person.email}`}>
            {person.email}
          </a>

          <h1 className="sr-only">
            {person.name}: software and business systems. {person.intro}
          </h1>
          <div className="hero-words" aria-hidden="true">
            <span className="line line-1">
              <Word text="Software" />
              <span className="amp">
                <Word text="&" delay={360} />
              </span>
            </span>
            <span className="line line-2">
              <Word text="Business" delay={180} />
            </span>
            <span className="line line-3">
              <Word text="Systems" delay={320} />
            </span>
            <span className="line line-arrow">
              <span className="ch" style={{ '--i': 0, '--d': '700ms' } as CSSProperties}>
                <Arrow />
              </span>
            </span>
          </div>

          <p className="hero-intro">{person.intro}</p>
          <a className="stat stat-1" href="#what">
            {systemCount} connected systems
          </a>
          <a className="stat stat-2" href="#inventonet">
            12-step procure-to-pay
          </a>
          <p className="hero-foot">
            <span>{person.location}</span>
            <span>Scroll</span>
          </p>
        </header>

        {/* What I do -------------------------------------------------------- */}
        <section className="what" id="what" aria-labelledby="what-title">
          <div className="what-pin">
            <p className="tag">[ What I do ]</p>
            <div className="what-copy">
              <h2 id="what-title" className="big">
                {person.statement}
              </h2>
              <p className="what-scope">{person.scope}</p>
            </div>
          </div>
          <ul className="tiles" aria-label="Some of the systems">
            {tiles.map(({ system: s, shot }, i) => (
              <li key={s.id} className={`tile tile-${i + 1}`}>
                <a href={`#${s.id}`}>
                  <img src={shot} alt={`The ${s.name} website`} loading="lazy" />
                  <span className="tile-label">
                    <strong>{s.name}</strong>
                    <span>{s.kind}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Featured --------------------------------------------------------- */}
        <section className="featured" id="work" aria-labelledby="work-title">
          <header className="featured-head" data-sink>
            <h2 id="work-title" className="giant">
              <span className="line">
                <Word text="Featured." />
              </span>
            </h2>
            <p className="tag">[ Case studies ]</p>
          </header>

          {featured.map(({ system: s, shot, phone }, i) => (
            <article key={s.id} className="case" id={`case-${s.id}`}>
              <a className="case-visual" href={`#${s.id}`} aria-label={`${s.name}, full details`}>
                <img className="case-shot" src={shot} alt={`The ${s.name} website`} loading="lazy" />
                {phone && <img className="case-phone" src={phone} alt={`The ${s.name} app`} loading="lazy" />}
              </a>
              <div className="case-copy">
                <p className="case-num">{i + 1}</p>
                <h3>{s.summary}</h3>
                <p className="case-tags">
                  {[s.kind, ...s.tech.filter((t) => !s.kind.includes(t)).slice(0, 2)].join(', ')}
                </p>
              </div>
              <a className="case-next" href={i < featured.length - 1 ? `#case-${featured[i + 1].system.id}` : '#shipped'}>
                {i < featured.length - 1 ? 'Next project' : 'What I’ve shipped'}
              </a>
            </article>
          ))}
        </section>

        {/* Shipped ---------------------------------------------------------- */}
        <section className="shipped" id="shipped" aria-labelledby="shipped-title">
          <div className="shipped-pin" data-sink>
            <p className="tag">[ What I’ve shipped ]</p>
            <h2 id="shipped-title" className="giant giant-center">
              <span className="line">
                <Word text="Shipped" />
              </span>
              <span className="line">
                <Word text="and" delay={150} />
              </span>
              <span className="line">
                <Word text="running" delay={300} />
              </span>
            </h2>
          </div>
          <ol className="proofs">
            {shipped.map((a, i) => (
              <li key={a.title} className="proof">
                <p className="proof-num">{i + 1}</p>
                <p className="proof-quote">{a.body}</p>
                <p className="proof-name">{a.title}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* About ------------------------------------------------------------ */}
        <section className="about" id="about" aria-labelledby="about-title">
          <h2 id="about-title" className="big about-lead">
            {person.about}
          </h2>

          <div className="about-row about-start">
            <p className="tag">[ How I work ]</p>
            <img
              src={denimFront}
              alt="Eleandre Sales in a denim jacket and round sunglasses"
              width="900"
              height="1350"
              loading="lazy"
            />
            <p className="body">{interview[1].a}</p>
          </div>

          <div className="about-row about-me">
            <div>
              <p className="tag">[ About me ]</p>
              <p className="body">{interview[2].a}</p>
            </div>
            <div className="marquee" aria-hidden="true">
              <div className="marquee-track">
                {[...strip, ...strip].map((src, i) => (
                  <img key={i} src={src} alt="" loading="lazy" />
                ))}
              </div>
            </div>
          </div>

          <div className="about-row about-focus">
            <h2 className="big">{person.focusLine}</h2>
            <img
              src={night}
              alt="Eleandre Sales at night in round sunglasses and a black T-shirt"
              width="1200"
              height="1200"
              loading="lazy"
            />
          </div>

          <div className="about-row about-best">
            <div>
              <p className="tag">[ What I do best ]</p>
              <p className="small">{[...focus, ...tools.flatMap((t) => t.items).slice(0, 14)].join(', ')}.</p>
              <p className="small about-now">{interview[0].a}</p>
            </div>
            <p className="body body-alt">{person.tagline}</p>
            <a className="btn" href={person.links[0].href}>
              View GitHub
            </a>
          </div>
        </section>

        {/* Build together --------------------------------------------------- */}
        <section className="together" aria-labelledby="together-title">
          {scattered.map((src, i) => (
            <img key={i} className={`float float-${i + 1}`} src={src} alt="" loading="lazy" />
          ))}
          <h2 id="together-title">Let’s build something together.</h2>
          <a className="btn btn-avatar" href="#archive">
            <img src={avatar} alt="" width="28" height="28" />
            See every system
          </a>
        </section>

        {/* Archive: every system --------------------------------------------- */}
        <section className="archive" id="archive" aria-labelledby="archive-title">
          <header className="archive-head">
            <p className="tag">[ Archive ]</p>
            <h2 id="archive-title" className="big">
              Every system, in detail
            </h2>
          </header>
          {families.map((fam) => (
            <section key={fam.name} className="family" aria-label={fam.name}>
              <header className="family-head">
                <h3>{fam.name}</h3>
                <p>{fam.blurb}</p>
              </header>
              {fam.systems.map((s) => (
                <SystemRow key={s.id} system={s} />
              ))}
            </section>
          ))}

          <section className="tools" aria-labelledby="tools-title">
            <p className="tag" id="tools-title">
              [ Tools I use ]
            </p>
            <dl>
              {tools.map((t) => (
                <div key={t.group}>
                  <dt>{t.group}</dt>
                  <dd>{t.items.join(', ')}</dd>
                </div>
              ))}
            </dl>
          </section>
        </section>
      </main>

      {/* Footer ------------------------------------------------------------- */}
      <footer className="footer" id="contact" aria-labelledby="contact-title">
        <div className="footer-top">
          <p className="big footer-pitch">Have a process that should be a system? Tell me about it.</p>
          <div className="footer-contact">
            <h2 id="contact-title">Ready to start?</h2>
            <div className="mail-row">
              <a className="mail" href={`mailto:${person.email}`}>
                {person.email}
              </a>
              <button type="button" className="copy" onClick={copyEmail} aria-live="polite">
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </div>
        <div className="footer-grid">
          <div>
            <p className="footer-label">Site</p>
            <ul className="footer-links">
              <li>
                <a href="#top">Home</a>
              </li>
              <li>
                <a href="#work">Work</a>
              </li>
              <li>
                <a href="#shipped">Shipped</a>
              </li>
              <li>
                <a href="#about">About</a>
              </li>
              <li>
                <a href="#archive">Systems</a>
              </li>
            </ul>
          </div>
          <div>
            <p className="footer-label">Follow</p>
            <ul className="footer-links">
              {person.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
            </ul>
          </div>
          <p className="footer-motto">
            <span>{person.signOff[0]}</span>
            <span>{person.signOff[1]}</span>
          </p>
        </div>
        <p className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {person.name}
          </span>
          <a href="#top">Back to top</a>
        </p>
      </footer>
    </>
  )
}

function SystemRow({ system: s }: { system: System }) {
  return (
    <details className="system" id={s.id}>
      <summary>
        <span className="system-name">{s.name}</span>
        <span className="system-kind">{s.kind}</span>
        <span className="system-summary">{s.summary}</span>
        <span className="system-toggle" aria-hidden="true" />
      </summary>
      <div className="system-body">
        {s.lead && <p className="system-lead">{s.lead}</p>}
        {s.steps && (
          <div className="steps">
            <h4>{s.steps.title}</h4>
            <ol>
              {s.steps.list.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="parts">
          {s.parts.map((p) => (
            <div key={p.title} className="part">
              <h4>{p.title}</h4>
              {p.body && <p>{p.body}</p>}
              {p.items && (
                <ul>
                  {p.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="system-tech">Built with {s.tech.join(', ')}.</p>
        {s.next && <p className="system-next">Next: {s.next}</p>}
      </div>
    </details>
  )
}
