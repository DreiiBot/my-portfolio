import { useEffect, useRef, useState } from 'react'
import greyPortrait from './assets/eleandre-portrait-800.jpg'
import greyPortraitLarge from './assets/eleandre-portrait-1200.jpg'
import redPortrait from './assets/eleandre-red.jpg'
import { achievements, families, focus, interview, person, systemCount, tools } from './content'
import type { System } from './content'
import { createPortraitField } from './three/portraitField'

const WALL = [201, 204, 203]
const OXBLOOD = [94, 14, 23]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const ramp = (v: number, from: number, to: number) => {
  const t = clamp01((v - from) / (to - from))
  return t * t * (3 - 2 * t)
}
const sections = [
  { id: 'profile', label: 'Profile' },
  { id: 'work', label: 'Work' },
  { id: 'systems', label: 'Systems' },
  { id: 'contact', label: 'Contact' },
]
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

export default function App() {
  const stage = useRef<HTMLDivElement>(null)
  const [webgl, setWebgl] = useState(true)
  const [ready, setReady] = useState(false)
  const [current, setCurrent] = useState<string>()

  // The nav underlines whichever section holds the upper third of the viewport.
  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight / 3
      const passed = sections.filter((s) => document.getElementById(s.id)!.getBoundingClientRect().top <= line)
      setCurrent(passed.at(-1)?.id)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const field = createPortraitField(stage.current!, {
      a: greyPortrait,
      b: redPortrait,
      reducedMotion,
      onReady: () => setReady(true),
    })
    if (!field) {
      setWebgl(false)
      return
    }

    const root = document.documentElement
    const el = (id: string) => document.getElementById(id)!
    let tops = { profile: 0, work: 0, contact: 0 }
    // The cover portrait stands in whatever horizontal space the cover lines leave free.
    let free = { center: 0, width: 0 }
    const measure = () => {
      const top = (id: string) => el(id).getBoundingClientRect().top + window.scrollY
      tops = { profile: top('profile'), work: top('work'), contact: top('contact') }
      const [left, right] = Array.from(document.querySelectorAll('.coverline')).map((n) => n.getBoundingClientRect())
      const sideBySide = right.left > left.right
      const from = left.right + 24
      const to = (sideBySide ? right.left : window.innerWidth) - 24
      free = { center: (from + to) / 2, width: to - from }
    }

    // The whole page is one continuous shot: the backdrop color and the portrait's pose are
    // both functions of scroll position, keyed to where each section starts.
    const update = () => {
      const vh = window.innerHeight
      const y = window.scrollY
      const wide = window.innerWidth >= 900
      const p1 = ramp(y, tops.profile - 0.85 * vh, tops.profile - 0.2 * vh)
      const p2 = ramp(y, tops.work - 0.8 * vh, tops.work - 0.15 * vh)
      const p3 = ramp(y, tops.contact - 0.95 * vh, tops.contact - 0.2 * vh)

      const red = p1 * (1 - p2)
      const bg = WALL.map((w, i) => Math.round(w + (OXBLOOD[i] - w) * red))
      root.style.setProperty('--backdrop', `rgb(${bg.join(' ')})`)
      root.dataset.tone = red > 0.5 ? 'oxblood' : 'wall'

      const vw = field.visibleWidth()
      const perPx = vw / window.innerWidth
      // The shoulders span about 74% of the photo's 2.4 world units.
      const heroScale = Math.min(1.34, (free.width * perPx) / (0.74 * 2.4))
      const heroX = (free.center - window.innerWidth / 2) * perPx
      const pose = wide
        ? { hero: [heroX, -0.3, heroScale, 0], profile: [-vw * 0.23, -0.05, 1.28, 0.28], contact: [vw * 0.21, -0.2, 1.2, -0.24] }
        : { hero: [0, 0.05, 0.92, 0], profile: [0, 0.1, 1.05, 0], contact: [0, 0.35, 0.9, 0] }
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t
      const at = (i: number) => lerp(lerp(pose.hero[i], pose.profile[i], p1), pose.contact[i], p3)

      Object.assign(field.target, {
        mix: red,
        scatter: p2 * (1 - p3),
        x: at(0),
        y: at(1),
        scale: at(2),
        turn: at(3),
        // On narrow screens the text sits on top of the portrait, so the portrait steps back.
        opacity: wide ? 1 : lerp(1, 0.28, Math.max(red, p3)),
      })
    }

    const onResize = () => {
      measure()
      update()
    }
    measure()
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      field.dispose()
    }
  }, [])

  return (
    <>
      <a className="skip" href="#profile">
        Skip to profile
      </a>
      <div
        ref={stage}
        className="stage"
        data-ready={ready || undefined}
        role="img"
        aria-label="Portrait of Eleandre Sales, drawn in points, in round sunglasses, a black turtleneck, an open black shirt and a gold chain"
      />

      <nav className="nav" aria-label="Sections">
        <a href="#top" className="monogram" aria-label="Back to top">
          ES
        </a>
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} aria-current={current === s.id ? 'location' : undefined}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main>
        <header className="cover" id="top">
          <h1 className="masthead">
            <span className="masthead-first">{person.first}</span>{' '}
            <span className="masthead-last">{person.last}</span>
          </h1>
          {!webgl && <img className="still still-cover" src={greyPortraitLarge} alt="" />}
          <div className="coverlines lift">
            <p className="coverline">
              {person.role} in the Philippines. I build the systems small businesses run on.
            </p>
            <a className="coverline coverline-story" href="#work">
              <strong>How one point of sale grew into {words[systemCount]} connected systems</strong>
              <span>Checkout, procurement, invoicing, WiFi, door access and AI</span>
            </a>
          </div>
        </header>

        <section className="profile" id="profile" aria-labelledby="profile-title">
          {!webgl && <img className="still still-profile" src={redPortrait} alt="" />}
          <div className="profile-copy lift">
            <p className="slug">Profile, in my own words</p>
            <h2 id="profile-title" className="section-title tagline">
              {person.tagline}
            </h2>
            <dl className="qa">
              {interview.map((item) => (
                <div key={item.q}>
                  <dt className="subhead">{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
            <h3 className="subhead focus-title">Where I spend my time</h3>
            <ul className="focus">
              {focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="work" id="work" aria-labelledby="work-title">
          <div className="lift work-inner">
            <p className="slug">Work</p>
            <header className="work-head">
              <h2 id="work-title" className="section-title section-title-lg">
                What I’ve built
              </h2>
              <p>
                Most of it for small and medium businesses in the Philippines, and most of it connected: one system’s
                records become another system’s input.
              </p>
            </header>

            <ul className="feats">
              {achievements.map((a) => (
                <li key={a.title}>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </li>
              ))}
            </ul>

            <section className="systems" id="systems" aria-labelledby="systems-title">
              <p className="slug">Systems</p>
              <h2 id="systems-title" className="section-title section-title-lg">
                Every system, in detail
              </h2>
              <p className="systems-note">Open any system to see what it does and what it’s built with.</p>
              {families.map((fam) => (
                <section key={fam.name} className="family" aria-label={fam.name}>
                  <header className="family-head">
                    <h3 className="subhead">{fam.name}</h3>
                    <p>{fam.blurb}</p>
                  </header>
                  {fam.systems.map((s) => (
                    <SystemRow key={s.id} system={s} />
                  ))}
                </section>
              ))}
            </section>

            <section className="tools" id="tools" aria-labelledby="tools-title">
              <p className="slug">Toolkit</p>
              <h2 id="tools-title" className="section-title section-title-lg">
                Tools I use
              </h2>
              <dl>
                {tools.map((t) => (
                  <div key={t.group}>
                    <dt className="subhead">{t.group}</dt>
                    <dd>{t.items.join(', ')}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </section>
      </main>

      <footer className="contact" id="contact" aria-labelledby="contact-title">
        <div className="contact-copy lift">
          <p className="slug">Contact</p>
          <h2 id="contact-title" className="section-title">
            Have a process that should be a system? Tell me about it.
          </h2>
          <a className="mail" href={`mailto:${person.email}`}>
            {person.email}
          </a>
          <ul className="elsewhere">
            {person.links.map((l) => (
              <li key={l.label}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
          <p className="colophon">
            © {new Date().getFullYear()} {person.name}. The portrait is drawn live in three.js from two photographs.
          </p>
        </div>
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
