import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useUI } from '../context'
import { navItems, profile } from '../data/profile'
import { familySlug, projects } from '../data/projects'
import { stack } from '../data/stack'
import { Search } from './Icons'

interface Item {
  id: string
  group: 'Sections' | 'Projects' | 'Tools'
  label: string
  hint?: string
  family?: string
  run: () => void
}

const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const { openProject } = useUI()

  const items = useMemo<Item[]>(
    () => [
      { id: 's-top', group: 'Sections', label: 'Home', hint: profile.name, run: () => goTo('top') },
      ...navItems.map((n) => ({ id: `s-${n.id}`, group: 'Sections' as const, label: n.label, run: () => goTo(n.id) })),
      ...projects.map((p) => ({
        id: `p-${p.id}`,
        group: 'Projects' as const,
        label: p.name,
        hint: p.category,
        family: familySlug[p.family],
        run: () => openProject(p.id),
      })),
      ...stack.flatMap((g) =>
        g.items.map((t) => ({
          id: `t-${t}`,
          group: 'Tools' as const,
          label: t,
          hint: g.group,
          run: () => {
            goTo('stack')
            window.dispatchEvent(new CustomEvent('select-tool', { detail: t }))
          },
        })),
      ),
    ],
    [openProject],
  )

  const q = query.trim().toLowerCase()
  const results = q
    ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q))
    : items.filter((i) => i.group !== 'Tools')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    ref.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const run = (item: Item) => {
    ref.current?.close()
    item.run()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault()
      run(results[cursor])
    }
  }

  let lastGroup = ''

  return (
    <dialog
      ref={ref}
      className="command"
      aria-label="Search the portfolio"
      onClose={() => {
        setQuery('')
        setCursor(0)
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="command__box">
        <label className="command__field">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search projects, sections and tools"
            aria-label="Search projects, sections and tools"
            aria-controls="command-results"
            aria-activedescendant={results[cursor] ? `cmd-${results[cursor].id}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="command-results" className="command__results" role="listbox" aria-label="Results">
          {results.length === 0 && <li className="command__empty">Nothing matches “{query}”. Try a project or a tool name.</li>}
          {results.map((item, n) => {
            const heading = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <li key={item.id} role="presentation">
                {heading && <p className="command__group">{heading}</p>}
                <div
                  id={`cmd-${item.id}`}
                  role="option"
                  aria-selected={n === cursor}
                  data-cursor={n === cursor}
                  data-family={item.family}
                  className="command__item"
                  onMouseMove={() => setCursor(n)}
                  onClick={() => run(item)}
                >
                  {item.family && <span className="swatch" aria-hidden />}
                  <span className="command__label">{item.label}</span>
                  {item.hint && <span className="command__hint">{item.hint}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </dialog>
  )
}
