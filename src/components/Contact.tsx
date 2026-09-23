import { useState } from 'react'
import { profile } from '../data/profile'
import { familySlug, projects } from '../data/projects'
import { ArrowUpRight } from './Icons'

export function Contact() {
  const [copied, setCopied] = useState(false)

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(profile.email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.location.href = `mailto:${profile.email}`
    }
  }

  return (
    <footer id="contact" className="contact">
      <div className="wrap">
        {/* The systems above, closing the page as one row of family colors */}
        <ul className="contact__spectrum" aria-hidden>
          {projects.map((p) => (
            <li key={p.id} data-family={familySlug[p.family]} />
          ))}
        </ul>

        <div className="contact__grid">
          <h2 className="contact__title">Have a system in mind?</h2>
          <div className="contact__side">
            <p className="contact__text">
              I’m happy to talk through a project, a role, or a problem your business keeps working around.
            </p>
            <ul className="contact__links">
              {profile.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                    <ArrowUpRight />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="contact__email">
          <a href={`mailto:${profile.email}`}>{profile.email}</a>
          <button type="button" onClick={copyEmail}>
            <span aria-live="polite">{copied ? 'Copied' : 'Copy email'}</span>
          </button>
        </div>

        <p className="contact__foot">
          © {new Date().getFullYear()} {profile.name}
        </p>
      </div>
    </footer>
  )
}
