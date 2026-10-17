// PROTOTYPE, throwaway. Variant C command menu (⌘K): jump to Titles and screens, run actions, and add Titles from TMDB inline.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarClock, CornerDownLeft, Film, Inbox, Info, LibraryBig, Moon, Plus, RefreshCw, ScrollText, Settings, Sparkles, Tv, Wand, X } from 'lucide-react'
import { go, useParam } from '../../nav'
import { SLOTS, TODAY, addResults, type AddResult, type Kind, type Slot, type Title } from '../../mock'
import { Badge, Button, Kbd, Poster, Select, cx } from '../../ui'
import { useStore } from './store'
import { Checkbox, MOD, Segmented, SlotDots } from './bits'

type Item = { id: string; group: string; label: string; sub?: string; icon: ReactNode; right?: ReactNode; keywords?: string; disabled?: boolean; run: () => void }

export function CommandMenu() {
  const { menu } = useStore()
  if (!menu.open) return null
  return <Menu key={menu.nonce} initialMode={menu.mode} />
}

function Menu({ initialMode }: { initialMode: 'root' | 'add' }) {
  const s = useStore()
  const screen = useParam('screen')
  const [mode, setMode] = useState(initialMode)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [confirm, setConfirm] = useState<AddResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => {
    s.closeMenu()
    if (screen === 'add') go('overview')
  }
  const run = (fn: () => void) => () => {
    s.closeMenu()
    fn()
  }
  const toAdd = (q = '') => {
    setMode('add')
    setQuery(q)
    setSel(0)
    inputRef.current?.focus()
  }

  const q = query.trim().toLowerCase()
  const match = (i: Item) => !q || `${i.label} ${i.sub ?? ''} ${i.keywords ?? ''}`.toLowerCase().includes(q)

  let items: Item[]
  if (mode === 'root') {
    const actions: Item[] = [
      { id: 'add', group: 'Actions', label: 'Add Title…', icon: <Plus className="size-4" />, keywords: 'new movie series tmdb', run: () => toAdd() },
      { id: 'missing', group: 'Actions', label: 'Search all missing', icon: <RefreshCw className="size-4" />, keywords: 'search versions', run: run(s.searchAllMissing) },
      { id: 'trash', group: 'Actions', label: 'Update from TRaSH', icon: <Sparkles className="size-4" />, keywords: 'profiles custom formats', run: run(s.updateTrash) },
      { id: 'dark', group: 'Actions', label: 'Toggle dark mode', icon: <Moon className="size-4" />, keywords: 'theme light', run: run(() => document.documentElement.classList.toggle('dark')) },
      { id: 'wizard', group: 'Actions', label: 'Run setup again', icon: <Wand className="size-4" />, keywords: 'wizard first run', run: run(() => go('wizard')) },
    ]
    const nav: Item[] = [
      { id: 'g-overview', group: 'Go to', label: 'Overview', icon: <Inbox className="size-4" />, keywords: 'home attention queue', run: run(() => go('overview')) },
      { id: 'g-library', group: 'Go to', label: 'Library', icon: <LibraryBig className="size-4" />, run: run(() => go('library')) },
      { id: 'g-upcoming', group: 'Go to', label: 'Upcoming', icon: <CalendarClock className="size-4" />, keywords: 'calendar', run: run(() => go('upcoming')) },
      { id: 'g-log', group: 'Go to', label: 'Log', icon: <ScrollText className="size-4" />, keywords: 'activity history blocklist', run: run(() => go('activity')) },
      { id: 'g-blocklist', group: 'Go to', label: 'Blocklist', icon: <ScrollText className="size-4" />, run: run(() => go('activity', { view: 'blocklist' })) },
      { id: 'g-settings', group: 'Go to', label: 'Settings', icon: <Settings className="size-4" />, keywords: 'profiles indexers sabnzbd language', run: run(() => go('settings')) },
      { id: 'g-about', group: 'Go to', label: 'About', icon: <Info className="size-4" />, keywords: 'tmdb thetvdb license', run: run(() => go('about')) },
    ]
    const titleItems: Item[] = [...s.titles]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((t) => ({
        id: `t-${t.id}`,
        group: 'Titles',
        label: t.title,
        sub: t.primaryTitle && t.primaryTitle !== t.title ? t.primaryTitle : String(t.year),
        keywords: `${t.year} ${t.kind}`,
        icon: t.kind === 'movie' ? <Film className="size-4" /> : <Tv className="size-4" />,
        right: <SlotDots t={t} />,
        run: run(() => go('library', { id: t.id })),
      }))
    const groups = q ? [titleItems, nav, actions] : [actions, nav, titleItems]
    items = groups.flatMap((g) => g.filter(match))
    if (q) items.push({ id: 'add-q', group: 'Actions', label: `Add “${query.trim()}”…`, sub: 'Search TMDB', icon: <Plus className="size-4" />, run: () => toAdd(query.trim()) })
  } else {
    items = addResults
      .filter((r) => !q || `${r.title} ${r.primaryTitle ?? ''} ${r.year}`.toLowerCase().includes(q))
      .map((r) => ({
        id: `a-${r.tmdbId}`,
        group: `TMDB · Movies and Series`,
        label: r.title,
        sub: [r.primaryTitle, r.year, r.certification].filter(Boolean).join(' · '),
        icon: <Poster title={r.title} hue={r.hue} small className="w-5 rounded-[3px]" />,
        disabled: r.notOnTvdb,
        right: (
          <span className="flex items-center gap-1.5">
            <Badge tone={r.kind === 'movie' ? 'gray' : 'blue'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
            {r.inLibrary && <Badge tone="green">In library</Badge>}
            {r.notOnTvdb && <Badge tone="amber">Not on TheTVDB</Badge>}
          </span>
        ),
        run: () => {
          if (r.notOnTvdb) return
          if (r.inLibrary) {
            const t = s.titles.find((x) => x.tmdbId === r.tmdbId)
            return run(() => go('library', { id: t?.id ?? '' }))()
          }
          setConfirm(r)
        },
      }))
  }

  const cur = Math.min(sel, items.length - 1)
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cur}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cur])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (confirm) setConfirm(null)
      else close()
      return
    }
    if (confirm) return
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setSel(Math.min(items.length - 1, cur + 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setSel(Math.max(0, cur - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = items[cur]
      if (it && !it.disabled) it.run()
    } else if (e.key === 'Backspace' && !query && mode === 'add') {
      setMode('root')
      setSel(0)
    }
  }

  let lastGroup = ''
  return (
    <div data-cmdk className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={close}>
      <div onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} className="flex max-h-[70vh] w-[640px] flex-col overflow-hidden rounded-xl border border-gray-alpha-400 bg-background-100 shadow-[0_16px_70px_rgba(0,0,0,0.3)]">
        {confirm ? (
          <AddConfirm r={confirm} onBack={() => setConfirm(null)} onDone={(t) => {
            s.closeMenu()
            go('library', { id: t.id })
          }} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-4">
              {mode === 'add' && (
                <button onClick={() => (setMode('root'), setSel(0), inputRef.current?.focus())} className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-gray-alpha-200 px-2 text-[12px] font-medium hover:bg-gray-alpha-400">
                  Add Title <X className="size-3" />
                </button>
              )}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => (setQuery(e.target.value), setSel(0))}
                placeholder={mode === 'add' ? 'Search TMDB for a Movie or Series…' : 'Search Titles, screens and actions…'}
                className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-gray-700"
              />
              <Kbd>esc</Kbd>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-2">
              {items.length === 0 && <div className="px-3 py-8 text-center text-gray-900">No results for “{query}”.</div>}
              {items.map((it, i) => {
                const head = it.group !== lastGroup
                lastGroup = it.group
                return (
                  <div key={it.id}>
                    {head && <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-gray-900">{it.group}</div>}
                    <div
                      data-idx={i}
                      onMouseMove={() => i !== cur && setSel(i)}
                      onClick={() => !it.disabled && it.run()}
                      title={it.disabled ? 'Not on TheTVDB: Series need TheTVDB for episodes, so it can’t be added' : undefined}
                      className={cx('flex h-10 items-center gap-3 rounded-md px-2', it.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', i === cur && 'bg-gray-alpha-200')}
                    >
                      <span className="flex w-5 shrink-0 justify-center text-gray-900">{it.icon}</span>
                      <span className="truncate text-[14px] text-gray-1000">{it.label}</span>
                      {it.sub && <span className="truncate text-[13px] text-gray-900">{it.sub}</span>}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {it.right}
                        {i === cur && !it.disabled && <CornerDownLeft className="size-3.5 text-gray-900" />}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2 text-[11px] text-gray-900">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> {mode === 'add' ? 'choose' : 'open'}
              </span>
              {mode === 'add' && (
                <span className="flex items-center gap-1">
                  <Kbd>⌫</Kbd> back
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                <Kbd>{MOD}</Kbd>
                <Kbd>K</Kbd> toggle
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Which Slot and Profile a new Title gets before the user touches anything. */
export function preselect(cert: string, kind: Kind, profiles: ReturnType<typeof useStore>['profiles'], kidsRule: { on: boolean; threshold: number }) {
  const age = parseInt(cert.replace(/\D/g, ''), 10)
  if (kidsRule.on && !Number.isNaN(age) && age <= kidsRule.threshold) {
    const kids = profiles.find((p) => p.kids && p.requires === 'primary' && p.enabled)!
    return { picks: { [kids.slot]: kids.id } as Partial<Record<Slot, string>>, why: `${kids.slot} · ${kids.name} (${cert}) — Kids rule` }
  }
  const picks: Partial<Record<Slot, string>> = {}
  for (const p of profiles) if (p.enabled && p.defaultFor.includes(kind)) picks[p.slot] = p.id
  const first = SLOTS.find((x) => picks[x])!
  return { picks, why: `${first} · ${profiles.find((p) => p.id === picks[first])!.name} — default for new ${kind === 'movie' ? 'Movies' : 'Series'}` }
}

function AddConfirm({ r, onBack, onDone }: { r: AddResult; onBack: () => void; onDone: (t: Title) => void }) {
  const s = useStore()
  const pre = preselect(r.certification, r.kind, s.profiles, s.kidsRule)
  const [checked, setChecked] = useState<Record<Slot, boolean>>({ SD: !!pre.picks.SD, HD: !!pre.picks.HD, UHD: !!pre.picks.UHD })
  const [pick, setPick] = useState<Record<Slot, string>>(() => {
    const out = {} as Record<Slot, string>
    for (const sl of SLOTS) out[sl] = pre.picks[sl] ?? s.profiles.find((p) => p.slot === sl && p.enabled)!.id
    return out
  })
  const [monitoring, setMonitoring] = useState<'All' | 'Future only' | 'None'>('All')
  const roots = ['/data/media/movies', '/data/media/tv', '/data/media/kids']
  const [root, setRoot] = useState(r.kind === 'movie' ? roots[0] : roots[1])
  const any = SLOTS.some((x) => checked[x])

  const add = () => {
    if (!any) return
    const id = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const t: Title = {
      id, kind: r.kind, title: r.title, primaryTitle: r.primaryTitle, year: r.year, tmdbId: r.tmdbId, tvdbId: r.kind === 'series' ? 121361 : undefined, imdbId: 'tt—',
      overview: r.overview, runtime: '—', certification: r.certification, originalLanguage: 'English', genres: [], status: 'Released', monitoring,
      folder: `${root}/${r.title} (${r.year}) {${r.kind === 'movie' ? 'tmdb' : 'tvdb'}-${r.kind === 'movie' ? r.tmdbId : 121361}}`, hue: r.hue, seasons: r.kind === 'series' ? [] : undefined,
      versions: SLOTS.filter((x) => checked[x]).map((slot) => ({ slot, profileId: pick[slot], state: 'missing' as const, missingSince: TODAY, lastSearched: TODAY })),
    }
    s.addTitle(t)
    s.log({ type: 'Version added', titleId: id, label: r.title, detail: `Added in Kestrel · ${t.versions.map((v) => v.slot).join(', ')} · searching` })
    s.toast(`Added ${r.title} · searching ${t.versions.map((v) => v.slot).join(', ')}`)
    onDone(t)
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), add())
      }}
    >
      <div className="flex items-center gap-3 border-b border-gray-alpha-400 px-4 py-3">
        <button onClick={onBack} className="flex size-7 items-center justify-center rounded-md text-gray-900 hover:bg-gray-alpha-200 hover:text-gray-1000" aria-label="Back">
          <ArrowLeft className="size-4" />
        </button>
        <Poster title={r.title} hue={r.hue} small className="w-8" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{r.title}</span>
            <Badge tone={r.kind === 'movie' ? 'gray' : 'blue'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
          </div>
          <div className="truncate text-[12px] text-gray-900">{[r.primaryTitle, r.year, r.certification].filter(Boolean).join(' · ')} · tmdb:{r.tmdbId}</div>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="rounded-md bg-blue-200 px-3 py-2 text-[13px] text-blue-900">
          Preselected: <span className="font-medium">{pre.why}</span>
        </div>
        <div className="overflow-hidden rounded-md border border-gray-alpha-400">
          {SLOTS.map((slot) => {
            const opts = s.profiles.filter((p) => p.slot === slot && p.enabled)
            return (
              <div key={slot} className="flex h-10 items-center gap-3 border-b border-gray-alpha-400 px-3 last:border-b-0">
                <Checkbox checked={checked[slot]} onChange={(v) => setChecked({ ...checked, [slot]: v })} label={<span className="w-10 font-mono text-[12px] font-semibold">{slot}</span>} />
                <span className="text-gray-900">Profile</span>
                <Select className={cx('ml-auto h-7! w-44 text-[13px]!', !checked[slot] && 'opacity-50')} value={s.profiles.find((p) => p.id === pick[slot])!.name} options={opts.map((p) => p.name)} onChange={(n) => setPick({ ...pick, [slot]: opts.find((p) => p.name === n)!.id })} />
              </div>
            )
          })}
        </div>
        {r.kind === 'series' && (
          <div className="flex items-center justify-between">
            <span className="text-gray-900">Monitor episodes</span>
            <Segmented size="xs" value={monitoring} onChange={setMonitoring} options={(['All', 'Future only', 'None'] as const).map((m) => ({ value: m, label: m }))} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-gray-900">Root folder</span>
          <Select className="h-7! w-56 font-mono text-[12px]" value={root} options={roots} onChange={setRoot} />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">
        <span className="text-[11px] text-gray-900">{any ? 'Kestrel searches right after adding.' : 'Pick at least one Slot.'}</span>
        <Button size="sm" variant="tertiary" className="ml-auto" onClick={onBack}>
          Back <Kbd>esc</Kbd>
        </Button>
        <Button size="sm" variant="primary" autoFocus disabled={!any} onClick={add}>
          Add {r.kind === 'movie' ? 'Movie' : 'Series'}
          <span className="ml-1 font-mono text-[11px] opacity-70">{MOD}↵</span>
        </Button>
      </div>
    </div>
  )
}
