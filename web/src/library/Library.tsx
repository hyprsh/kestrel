import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTitles, type TitleRow } from '../api/queries'
import { Button } from '../forms'
import { useKey, useListNav } from '../keys'
import { cx, Kbd } from '../ui'
import { KindIcon, SlotDots } from './bits'
import { TitleDetail } from './TitleDetail'

type Kind = 'all' | 'movie' | 'series'
const kinds: { key: Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'series', label: 'Series' },
]

const norm = (s: string) => s.toLowerCase()

function matches(r: TitleRow, text: string): boolean {
  const t = norm(text.trim())
  return t === '' || norm(r.title).includes(t) || norm(r.primary_title).includes(t)
}

/**
 * The Library: a filterable list on the left and the selected Title on the
 * right. Everything is reachable from the keyboard: j/k and the arrows move,
 * Enter steps into the detail, Escape steps back, `/` filters.
 */
export function Library({ selectedId, onSelect, onAdd }: { selectedId: number | null; onSelect: (id: number) => void; onAdd: () => void }) {
  const titles = useTitles()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const all = titles.data ?? []
  const rows = useMemo(() => all.filter((r) => (kind === 'all' || r.kind === kind) && matches(r, text)), [all, kind, text])
  const index = Math.max(0, rows.findIndex((r) => r.id === selectedId)) // the first row until something is picked
  const current = rows[index] as TitleRow | undefined

  const focusList = () => listRef.current?.focus()
  useEffect(focusList, [])
  useListNav('lib', rows.length, index, (i) => onSelect(rows[i].id), () => paneRef.current?.focus())
  useKey('/', (e) => {
    e.preventDefault()
    filterRef.current?.focus()
  })

  const empty = titles.isSuccess && all.length === 0
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-alpha-400">
        <div className="flex flex-col gap-2 border-b border-gray-alpha-400 p-3">
          <div className="relative">
            <input
              ref={filterRef}
              type="text"
              aria-label="Filter the Library"
              placeholder="Filter"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const next = Math.min(Math.max(index + (e.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)
                  if (rows[next]) onSelect(rows[next].id)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setText('')
                  focusList()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  focusList()
                }
              }}
              className="h-8 w-full rounded-md border border-gray-alpha-400 bg-background-100 px-2.5 pr-8 text-[13px] outline-none focus:border-gray-700"
            />
            <span className="pointer-events-none absolute top-1.5 right-2">
              <Kbd>/</Kbd>
            </span>
          </div>
          <div role="group" aria-label="Kind" className="flex gap-1">
            {kinds.map((k) => (
              <button
                key={k.key}
                aria-pressed={kind === k.key}
                onClick={() => setKind(k.key)}
                className={cx(
                  'h-6 rounded-md px-2 text-[12px] font-medium',
                  kind === k.key ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Library"
          aria-activedescendant={current ? `title-${current.id}` : undefined}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto p-1.5 outline-none"
        >
          {rows.map((r, i) => (
            <div
              key={r.id}
              id={`title-${r.id}`}
              role="option"
              aria-selected={i === index}
              data-nav={`lib-${i}`}
              onClick={() => {
                onSelect(r.id)
                focusList()
              }}
              className={cx('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5', i === index ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')}
            >
              <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {r.title}
                  {r.year ? <span className="ml-1.5 font-normal text-gray-900">{r.year}</span> : null}
                </div>
                {r.primary_title !== r.title && (
                  <div data-primary-title className="truncate text-[12px] text-gray-900">
                    {r.primary_title}
                  </div>
                )}
              </div>
              <SlotDots slots={r.slots} />
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between border-t border-gray-alpha-400 px-3 py-2 text-[12px] text-gray-900">
          <span className="flex items-center gap-1">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move
          </span>
          <span>
            {rows.length} of {all.length}
          </span>
        </footer>
      </aside>

      {current ? (
        <TitleDetail key={current.id} ref={paneRef} row={current} onEscape={focusList} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-center">
          {titles.isError ? (
            <p role="alert" className="text-[12px] text-red-900">
              Could not load the Library.
            </p>
          ) : empty ? (
            <div>
              <div className="text-sm font-medium">Nothing here yet</div>
              <div className="mt-1 text-gray-900">Add your first Movie or Series.</div>
              <Button className="mt-3" onClick={onAdd}>
                <Plus className="mr-1 size-4" />
                Add a title
              </Button>
            </div>
          ) : titles.isSuccess ? (
            <div className="text-gray-900">No Title matches.</div>
          ) : null}
        </div>
      )}
    </div>
  )
}
