import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from '../context'
import { navItems, profile } from '../data/profile'
import { useActiveSection } from '../hooks/useActiveSection'
import { Search } from './Icons'

const sectionIds = ['top', ...navItems.map((item) => item.id)]

export function Nav() {
  const active = useActiveSection(sectionIds)
  const { openCommand } = useUI()
  const listRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Slide the highlight under whichever link matches the section on screen.
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
      setIndicator(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="nav__pill">
        <a href="#top" className="nav__brand" aria-label={`${profile.name}, back to top`}>
          {profile.initials}
        </a>
        <nav className="nav__links" aria-label="Main" ref={listRef}>
          {indicator && (
            <span className="nav__indicator" style={{ transform: `translateX(${indicator.x}px)`, width: indicator.w }} aria-hidden />
          )}
          {navItems.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="nav__link" aria-current={active === item.id ? 'true' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <button type="button" className="nav__search" onClick={openCommand} aria-label="Search the portfolio">
          <Search />
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
      </div>
    </header>
  )
}
