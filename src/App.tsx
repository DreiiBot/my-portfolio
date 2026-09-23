import { useCallback, useEffect, useMemo, useState } from 'react'
import { About } from './components/About'
import { CommandMenu } from './components/CommandMenu'
import { Contact } from './components/Contact'
import { Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { ProjectSheet } from './components/ProjectSheet'
import { Stack } from './components/Stack'
import { Work } from './components/Work'
import { UIContext } from './context'

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)

  const openProject = useCallback((id: string) => setProjectId(id), [])
  const openCommand = useCallback(() => setCommandOpen(true), [])
  const ui = useMemo(() => ({ openProject, openCommand }), [openProject, openCommand])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <UIContext.Provider value={ui}>
      <a href="#work" className="skip-link">
        Skip to work
      </a>
      <Nav />
      <main>
        <Hero />
        <Work />
        <About />
        <Stack />
      </main>
      <Contact />
      <ProjectSheet id={projectId} onChange={setProjectId} />
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
    </UIContext.Provider>
  )
}
