// PROTOTYPE, throwaway. Variant B · Posters.
// Library-first: a top header with Geist tabs above a poster grid; Title detail and manual search open as sheets over it.
import { useEffect, useRef, useState } from 'react'
import { Info, Plus, RotateCcw, Search } from 'lucide-react'
import { go, useParam } from '../../nav'
import { queue } from '../../mock'
import { Kbd, KestrelLogo, cx } from '../../ui'
import { Button, Menu, MenuItem, StoreProvider, useEscapeRoot } from './common'
import { Library } from './Library'
import { TitleSheet } from './TitleSheet'
import { ManualSearchSheet } from './ManualSearch'
import { AddDialog } from './AddDialog'
import { Upcoming } from './Upcoming'
import { Activity } from './Activity'
import { Settings } from './Settings'
import { Wizard } from './Wizard'
import { AboutDialog } from './About'

const tabs = [
  { key: 'library', label: 'Library' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
]
// Screens that sit on top of the poster grid.
const overLibrary = ['library', 'title', 'search', 'add', 'about']

export function VariantB() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  useEscapeRoot()
  const screen = useParam('screen', 'library')
  const id = useParam('id')
  const [query, setQuery] = useState('')

  if (screen === 'wizard') return <Wizard />

  const base = overLibrary.includes(screen) ? 'library' : screen
  return (
    <div className="min-h-full bg-background-100 text-[14px] text-gray-1000">
      <Header active={base} query={query} setQuery={setQuery} />
      <main className="mx-auto max-w-[1240px] px-6 pt-8 pb-28">
        {base === 'library' && <Library query={query} clearQuery={() => setQuery('')} />}
        {base === 'upcoming' && <Upcoming />}
        {base === 'activity' && <Activity />}
        {base === 'settings' && <Settings />}
      </main>
      {(screen === 'title' || screen === 'search') && id && <TitleSheet id={id} />}
      {screen === 'search' && id && <ManualSearchSheet id={id} />}
      {screen === 'add' && <AddDialog />}
      {screen === 'about' && <AboutDialog />}
    </div>
  )
}

function Header({ active, query, setQuery }: { active: string; query: string; setQuery: (q: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      if (e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const activeQueue = queue.filter((q) => q.phase !== 'queued').length

  return (
    <header className="sticky top-0 z-30 border-b border-gray-alpha-400 bg-background-100/90 backdrop-blur">
      <div className="mx-auto max-w-[1240px] px-6">
        <div className="flex h-16 items-center gap-3">
          <button onClick={() => go('library')} className="flex items-center gap-2">
            <KestrelLogo className="size-6" />
            <span className="text-[15px] font-semibold tracking-tight">Kestrel</span>
          </button>
          <svg viewBox="0 0 24 24" className="size-6 text-gray-alpha-400" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16.88 3.549L7.12 20.451" /></svg>
          <span className="flex items-center gap-2 text-sm text-gray-1000">
            Home library
            <span title="Primary Language" className="rounded-full border border-gray-alpha-400 px-2 py-0.5 text-[11px] font-medium text-gray-900">German</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            <label className="hidden h-9 w-72 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-100 px-3 text-sm focus-within:border-gray-600 focus-within:ring-2 focus-within:ring-gray-alpha-400 md:flex">
              <Search size={15} className="shrink-0 text-gray-900" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (active !== 'library') go('library')
                }}
                onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
                placeholder="Filter Titles…"
                className="w-full bg-transparent outline-none placeholder:text-gray-700"
              />
              {query ? (
                <button onClick={() => setQuery('')} className="text-[12px] text-gray-900 hover:text-gray-1000">Clear</button>
              ) : (
                <Kbd>/</Kbd>
              )}
            </label>
            <Button variant="primary" prefix={<Plus size={15} />} onClick={() => go('add')}>
              Add
            </Button>
            <Menu
              trigger={(toggle) => (
                <button onClick={toggle} aria-label="Account menu" className="ml-1 flex size-8 items-center justify-center rounded-full bg-gray-alpha-200 text-[12px] font-semibold text-gray-1000 ring-1 ring-gray-alpha-400 hover:bg-gray-alpha-400">N</button>
              )}
            >
              {(close) => (
                <>
                  <div className="px-2 pt-1.5 pb-2">
                    <div className="text-sm font-medium">nd</div>
                    <div className="text-[12px] text-gray-900">Owner · one household</div>
                  </div>
                  <div className="my-1 h-px bg-gray-alpha-400" />
                  <MenuItem icon={<Info size={15} />} onClick={() => (close(), go('about'))}>About</MenuItem>
                  <MenuItem icon={<RotateCcw size={15} />} onClick={() => (close(), go('wizard', { step: '0' }))}>Run setup again</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        <nav className="-mb-px flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => go(t.key)}
              className={cx('relative flex h-11 items-center gap-1.5 px-1 text-sm transition-colors', active === t.key ? 'text-gray-1000' : 'text-gray-900 hover:text-gray-1000')}
            >
              <span className="rounded-md px-2 py-1 hover:bg-gray-alpha-100">{t.label}</span>
              {t.key === 'activity' && activeQueue > 0 && (
                <span className="tabular -ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-700 px-1 text-[11px] font-medium text-white">{activeQueue}</span>
              )}
              {active === t.key && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-gray-1000" />}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
