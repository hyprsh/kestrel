// PROTOTYPE, throwaway. Variant C Library: split pane, keyboard-navigable Title list left, detail or manual search right.
import { useRef, useState } from 'react'
import { Film, Plus, Search, Tv } from 'lucide-react'
import { go, navigate, useParam } from '../../nav'
import { Kbd, cx } from '../../ui'
import { useStore } from './store'
import { Segmented, SlotDots, useKey, useListNav } from './bits'
import { TitleDetail } from './TitleDetail'
import { ManualSearch } from './ManualSearch'

export function Library() {
  const s = useStore()
  const screen = useParam('screen')
  const id = useParam('id')
  const slot = useParam('slot', 'HD')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'movie' | 'series'>('all')
  const filterRef = useRef<HTMLInputElement>(null)

  const list = s.titles
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter((t) => !q || `${t.title} ${t.primaryTitle ?? ''} ${t.year}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title))
  const selected = s.titles.find((t) => t.id === id) ?? list[0]
  const idx = list.findIndex((t) => t.id === selected?.id)
  const select = (i: number) => list[i] && navigate({ id: list[i].id }, true)

  useListNav('lib', list.length, idx, select, undefined, screen !== 'search')
  useKey('/', (e) => {
    e.preventDefault()
    filterRef.current?.focus()
  })

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-alpha-400 bg-background-200">
        <div className="flex flex-col gap-2 border-b border-gray-alpha-400 p-2">
          <label className="flex h-8 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-100 px-2 focus-within:ring-2 focus-within:ring-gray-alpha-400">
            <Search className="size-3.5 text-gray-900" />
            <input
              ref={filterRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), select(Math.min(list.length - 1, idx + 1)))
                if (e.key === 'ArrowUp') (e.preventDefault(), select(Math.max(0, idx - 1)))
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
              }}
              placeholder="Filter Titles"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-gray-700"
            />
            <Kbd>/</Kbd>
          </label>
          <div className="flex items-center justify-between">
            <Segmented
              size="xs"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'movie', label: 'Movies' },
                { value: 'series', label: 'Series' },
              ]}
            />
            <button onClick={() => s.openMenu('add')} title="Add Title" className="flex size-7 items-center justify-center rounded-md text-gray-900 hover:bg-gray-alpha-200 hover:text-gray-1000">
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {list.map((t, i) => (
            <button
              key={t.id}
              data-nav={`lib-${i}`}
              onClick={() => go('library', { id: t.id })}
              className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left', t.id === selected?.id ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')}
            >
              {t.kind === 'movie' ? <Film className="size-3.5 shrink-0 text-gray-700" /> : <Tv className="size-3.5 shrink-0 text-gray-700" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-1000">{t.title}</span>
                <span className="block truncate text-[12px] text-gray-900">{t.primaryTitle && t.primaryTitle !== t.title ? t.primaryTitle : t.year}</span>
              </span>
              <SlotDots t={t} />
            </button>
          ))}
          {!list.length && <div className="px-3 py-6 text-center text-gray-900">No Titles match.</div>}
        </div>
        <div className="flex items-center gap-1.5 border-t border-gray-alpha-400 px-3 py-2 text-[11px] text-gray-900">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> move
          <span className="ml-auto">
            {list.length} of {s.titles.length}
          </span>
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-gray-900">Select a Title</div>
        ) : screen === 'search' ? (
          <ManualSearch t={selected} slot={slot as 'SD' | 'HD' | 'UHD'} />
        ) : (
          <TitleDetail key={selected.id} t={selected} />
        )}
      </section>
    </div>
  )
}
