// chrome: pending
// Upcoming: a timeline around today. Days run from 14 back to 60 ahead (Show more in both directions),
// the view opens at the Today marker, and every entry says where it stands: not out, Wanted, downloading
// or Imported. j/k and Enter move and open (a group opens or closes), `o` shows an entry's overview, and
// `t` goes back to today.
import { Button, EmptyState, LoadMoreButton, Note, Tabs, Toggle } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchNow } from '../api/grabs'
import { useQueue, type QueueItem } from '../api/queue'
import { dayString, useTimeline, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
import { plural } from '../format'
import { useKey, useListNav } from '../keys'
import { TitlePoster } from '../poster'
import { useNow } from '../time'
import { NavRow } from '../NavRow'
import { cx } from '../ui'
import { EntryName, Markers, MovieNotes, otherDates, StateBadges, Standings, TallyBadges } from './bits'
import { useUpcomingFilters } from './filters'
import {
  airTime,
  buildDays,
  dayLabel,
  episodeRange,
  navRows,
  passes,
  relativeDay,
  tally,
  undatedKey,
  upcomingKey,
  weekOf,
  type Block,
  type Day,
} from './state'

const BACK = 14
const AHEAD = 60
const MORE_BACK = 30
const MORE_AHEAD = 60

const reasonText = {
  no_air_date: (u: UndatedItem) => `${plural(u.episodes, 'episode')} without an air date`,
  no_release_date: () => 'No release date yet',
  announced: () => 'Announced by TheTVDB, no episodes dated yet',
} as const

export function Upcoming({ onOpenTitle }: { onOpenTitle: (id: number) => void }) {
  const [back, setBack] = useState(BACK)
  const [ahead, setAhead] = useState(AHEAD)
  const timeline = useTimeline(back, ahead)
  const queue = useQueue().data ?? []
  const now = useNow()
  const [filters, setFilters] = useUpcomingFilters()
  const search = useSearchNow()
  const today = dayString()

  const items = useMemo(() => (timeline.data?.items ?? []).filter((i) => passes(i, filters)), [timeline.data, filters])
  const undated = useMemo(() => (timeline.data?.undated ?? []).filter((u) => passes(u, filters)), [timeline.data, filters])
  const days = useMemo(() => withToday(buildDays(items), today), [items, today])
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set()) // entries whose overview is open
  const rows = useMemo(() => navRows(days, undated, open), [days, undated, open])
  const todayAt = days.findIndex((d) => d.day === today)
  const anchorDay = days[Math.max(0, todayAt - 1)]?.day
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])

  // The cursor starts on the first row of today or later, and stays on its row as rows come and go.
  const [selKey, setSelKey] = useState<string | null>(null)
  const start = Math.max(0, rows.findIndex((r) => r.day >= today))
  const found = selKey === null ? -1 : (indexOf.get(selKey) ?? -1)
  const sel = found >= 0 ? found : Math.min(start, Math.max(0, rows.length - 1))
  const select = (i: number) => rows[i] && setSelKey(rows[i].key)

  // The view opens on the day before today, so today sits just below the top with the last day above it.
  const anchorRef = useRef<HTMLHeadingElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollToToday = (behavior: ScrollBehavior) => {
    const box = scrollRef.current
    const marker = anchorRef.current
    if (!box || !marker) return
    const top = box.scrollTop + marker.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTo?.({ top: Math.max(0, top), behavior })
  }
  const scrolled = useRef(false)
  useEffect(() => {
    if (!timeline.data || scrolled.current) return
    scrolled.current = true
    scrollToToday('instant')
  }, [timeline.data])

  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }
  const openRow = (i: number) => {
    const row = rows[i]
    if (!row) return
    if (row.type === 'group') setOpen((o) => toggle(o, row.key))
    else onOpenTitle(row.titleId)
  }
  useListNav('up', rows.length, sel, select, openRow)
  useKey('o', () => {
    const row = rows[sel]
    if (!row) return
    if (row.type === 'group') setOpen((o) => toggle(o, row.key))
    else if (row.type !== 'undated') setShown((s) => toggle(s, row.key))
  })
  const jumpToday = () => {
    setSelKey(rows[start]?.key ?? null)
    scrollToToday('smooth')
  }
  useKey('t', jumpToday)

  const onSearch = (item: UpcomingItem) => (slots: UpcomingSlot[]) => {
    const scope = item.kind === 'series' && item.episode_id != null ? { season: item.season!, episode_ids: [item.episode_id] } : undefined
    for (const slot of slots) search.mutate({ versionId: slot.version_id, scope })
  }

  const empty = timeline.data && items.length === 0 && undated.length === 0
  let lastWeek = ''
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-alpha-400 px-4 py-2">
        <Tabs
          variant="secondary"
          aria-label="Show"
          selected={filters.kind}
          onChange={(v) => setFilters({ kind: v as 'all' | 'movie' | 'series' })}
          tabs={[
            { value: 'all', title: 'All' },
            { value: 'movie', title: 'Movies' },
            { value: 'series', title: 'Series' },
          ]}
        />
        <Toggle size="small" labelCasing="normal" checked={filters.wantedOnly} onChange={(on) => setFilters({ wantedOnly: on })}>
          Wanted only
        </Toggle>
        <Toggle size="small" labelCasing="normal" checked={filters.hideImported} onChange={(on) => setFilters({ hideImported: on })}>
          Hide imported
        </Toggle>
        <Button variant="tertiary" size="small" className="ml-auto" onClick={jumpToday} title="Jump to today (t)">
          Today
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-3 pb-8 sm:px-4">
          {timeline.isError && <Note variant="error">Upcoming could not be loaded.</Note>}
          {search.isError && <Note variant="error">{search.error.message}</Note>}
          {timeline.data && (
            <LoadMoreButton noGap variant="tertiary" size="small" loading={timeline.isFetching} onClick={() => setBack((b) => b + MORE_BACK)} className="mt-2">
              Show earlier
            </LoadMoreButton>
          )}
          {empty && <EmptyState className="m-4 w-auto" description="Nothing is due in this window." />}
          <ul aria-label="Agenda" className="relative mt-2">
            <span aria-hidden className="absolute top-0 bottom-0 left-3 w-px bg-gray-alpha-400" />
            {days.map((d) => {
              const week = weekOf(today, d.day)
              const header = week !== lastWeek
              lastWeek = week
              return (
                <DayBlock
                  key={d.day}
                  day={d}
                  today={today}
                  week={header ? week : null}
                  headingRef={d.day === anchorDay ? anchorRef : undefined}
                  rowFor={(b) => (
                    <BlockRows
                      key={b.key}
                      block={b}
                      queue={queue}
                      now={now}
                      today={today}
                      sel={sel}
                      indexOf={indexOf}
                      open={open}
                      shown={shown}
                      onSelect={(i) => {
                        select(i)
                        openRow(i)
                      }}
                      onToggleOpen={(k) => setOpen((o) => toggle(o, k))}
                      onToggleShown={(k) => setShown((s) => toggle(s, k))}
                      onSearch={onSearch}
                    />
                  )}
                />
              )
            })}
          </ul>
          {timeline.data && (
            <LoadMoreButton variant="tertiary" size="small" loading={timeline.isFetching} onClick={() => setAhead((a) => a + MORE_AHEAD)}>
              Show later
            </LoadMoreButton>
          )}

          {undated.length > 0 && (
            <section aria-labelledby="no-date-yet" className="mt-8">
              <h2 id="no-date-yet" className="heading-14 mb-2">
                {`No date yet · ${undated.length}`}
              </h2>
              <ul aria-label="No date yet" className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
                {undated.map((u) => {
                  const i = indexOf.get(undatedKey(u)) ?? 0
                  return (
                    <NavRow key={undatedKey(u)} scope="up" index={i} sel={sel} onSelect={() => (select(i), openRow(i))} className="relative px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <TitlePoster id={u.title_id} hasPoster={u.has_poster} className="h-12 w-8 rounded" />
                        <div className="min-w-0 flex-1 basis-40">
                          <div className="label-14 truncate">
                            <span className="font-medium">{u.title}</span>
                            {u.year ? <span className="text-gray-900"> {u.year}</span> : null}
                          </div>
                          <div className="label-12 text-gray-900">
                            {u.network ? `${u.network} · ` : ''}
                            {reasonText[u.reason](u)}
                          </div>
                        </div>
                        <Standings title={{ kind: u.kind, title_id: u.title_id, season: null, episode: null }} slots={u.slots} queue={queue} now={now} />
                      </div>
                    </NavRow>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** The days with entries, plus today even when nothing is due on it, so the Today marker is always there. */
function withToday(days: Day[], today: string): Day[] {
  if (days.some((d) => d.day === today)) return days
  const at = days.findIndex((d) => d.day > today)
  const marker: Day = { day: today, blocks: [] }
  return at < 0 ? [...days, marker] : [...days.slice(0, at), marker, ...days.slice(at)]
}

function DayBlock({
  day,
  today,
  week,
  headingRef,
  rowFor,
}: {
  day: Day
  today: string
  week: string | null
  headingRef?: React.RefObject<HTMLHeadingElement | null>
  rowFor: (b: Block) => React.ReactNode
}) {
  const isToday = day.day === today
  const label = relativeDay(today, day.day)
  const date = dayLabel(day.day)
  return (
    <>
      {week && (
        <li role="presentation" className="label-12 relative pt-4 pb-1 pl-9 font-medium tracking-wide text-gray-900 uppercase">
          {week}
        </li>
      )}
      <li className="relative">
        <h3
          ref={headingRef}
          aria-current={isToday ? 'date' : undefined}
          className={cx('sticky top-0 z-10 flex items-center gap-2 bg-background-100 py-1.5 pl-9 label-14 font-medium', isToday && 'text-blue-900')}
        >
          <span aria-hidden className={cx('absolute top-1/2 left-[7px] -translate-y-1/2 rounded-full', isToday ? 'size-3 bg-blue-700 ring-4 ring-blue-700/20' : 'size-2 bg-gray-600')} />
          {label}
          {label !== date && <span className="label-12 font-normal text-gray-900">{date}</span>}
          {isToday && <span aria-hidden className="h-px flex-1 bg-blue-700/50" />}
        </h3>
        {day.blocks.length === 0 ? (
          <p className="label-12 pb-2 pl-9 text-gray-900">Nothing else is due today.</p>
        ) : (
          <ul aria-label={label}>{day.blocks.map((b) => rowFor(b))}</ul>
        )}
      </li>
    </>
  )
}

type RowProps = {
  queue: readonly QueueItem[]
  now: number
  today: string
  sel: number
  indexOf: ReadonlyMap<string, number>
  open: ReadonlySet<string>
  shown: ReadonlySet<string>
  onSelect: (index: number) => void
  onToggleOpen: (key: string) => void
  onToggleShown: (key: string) => void
  onSearch: (item: UpcomingItem) => (slots: UpcomingSlot[]) => void
}

function BlockRows({ block, ...p }: { block: Block } & RowProps) {
  if (block.type === 'entry') {
    return (
      <NavRow key={block.key} scope="up" index={p.indexOf.get(block.key) ?? 0} sel={p.sel} onSelect={() => p.onSelect(p.indexOf.get(block.key) ?? 0)} className="relative py-2 pr-3 pl-9 [&[aria-current=true]_.rail-dot]:ring-transparent">
        <Entry item={block.item} id={block.key} {...p} />
      </NavRow>
    )
  }
  const first = block.items[0]
  const expanded = p.open.has(block.key)
  const index = p.indexOf.get(block.key) ?? 0
  const at = airTime(first)
  return (
    <>
      <NavRow key={block.key} scope="up" index={index} sel={p.sel} onSelect={() => p.onSelect(index)} className="relative py-2 pr-3 pl-9 [&[aria-current=true]_.rail-dot]:ring-transparent">
        <Dot />
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <TitlePoster id={first.title_id} hasPoster={first.has_poster} className="h-12 w-8 rounded" />
          <div className="min-w-0 flex-1 basis-40">
            <div className="label-14 truncate">
              <span className="font-medium">{first.title}</span> <span className="text-gray-900">{episodeRange(block.items)} · {plural(block.items.length, 'episode')}</span>
            </div>
            <div className="label-12 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-900">
              {first.network && <span>{first.network}</span>}
              {at && <span className="tabular">{at}</span>}
              <Markers markers={[...new Set(block.items.flatMap((i) => i.markers))]} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TallyBadges tallies={tally(block.items, p.queue)} now={p.now} />
            <Button
              variant="tertiary"
              size="tiny"
              svgOnly
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} the ${plural(block.items.length, 'episode')} of ${first.title}`}
              onClick={(e) => {
                e.stopPropagation()
                p.onToggleOpen(block.key)
              }}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          </div>
        </div>
      </NavRow>
      {expanded &&
        block.items.map((item) => {
          const key = upcomingKey(item)
          const i = p.indexOf.get(key) ?? 0
          return (
            <NavRow key={key} scope="up" index={i} sel={p.sel} onSelect={() => p.onSelect(i)} className="relative py-1.5 pr-3 pl-16">
              <Entry item={item} id={key} child {...p} />
            </NavRow>
          )
        })}
    </>
  )
}

/** The rail's dot, drawn inside the row it belongs to. */
function Dot() {
  return <span aria-hidden className="rail-dot absolute top-5 left-2 size-2 rounded-full bg-gray-600 ring-4 ring-background-100" />
}

/** One entry: poster, name, context, state badges and a way to open its overview. */
function Entry({ item, id, child, ...p }: { item: UpcomingItem; id: string; child?: boolean } & RowProps) {
  const expanded = p.shown.has(id)
  const at = airTime(item)
  const others = item.kind === 'movie' ? otherDates(item, p.today) : ''
  const imported = item.slots.length > 0 && item.slots.every((s) => s.state === 'imported')
  const search = p.onSearch(item)
  return (
    <div data-imported={imported || undefined} className={cx(imported && 'opacity-60')}>
      {!child && <Dot />}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        {!child && <TitlePoster id={item.title_id} hasPoster={item.has_poster} className="h-12 w-8 rounded" />}
        <div className="min-w-0 flex-1 basis-40">
          <div className="label-14 truncate">
            <EntryName item={item} />
          </div>
          <div className="label-12 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-900">
            {item.network && <span>{item.network}</span>}
            {at && <span className="tabular">{at}</span>}
            {item.kind === 'movie' ? <MovieNotes item={item} /> : <Markers markers={item.markers} />}
          </div>
          {others && <div className="label-12 text-gray-900">{others}</div>}
        </div>
        <div className="flex items-center gap-2">
          <StateBadges item={item} queue={p.queue} now={p.now} onSearch={search} />
          <Button
            variant="tertiary"
            size="tiny"
            svgOnly
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} the overview of ${item.title}${item.kind === 'series' ? ` ${item.episode_name ?? ''}` : ''}`.trim()}
            onClick={(e) => {
              e.stopPropagation()
              p.onToggleShown(id)
            }}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        </div>
      </div>
      {expanded && <p className="copy-13 mt-1.5 max-w-prose text-gray-900">{item.overview ?? 'No overview yet.'}</p>}
    </div>
  )
}
