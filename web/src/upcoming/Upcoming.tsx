// Upcoming: a timeline around today. It opens on the months from 14 days back to 60 ahead and loads a month more when
// the reader nears either end; the calendar and the agenda follow each other by month. The view opens at the Today marker, and every entry says where it stands: not out, Wanted, downloading
// or Imported. j/k and Enter move and open (a group opens or closes), and
// `t` goes back to today.
import { Button, DotsMenu, EmptyState, Entity, MenuItem, MenuSection, Note } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchNow } from '../api/grabs'
import { useReport } from '../toasts'
import { useQueue, type QueueItem } from '../api/queue'
import { dayString, localDay, useAgendaChunks, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
import { plural } from '../format'
import { useKey, useListNav } from '../keys'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import { FacetFilterButton } from '../layout/FilterButton'
import { FilterChips, SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
import { usePhone } from '../responsive'
import { stackedRow, stackedRight } from '../layout/RowList'
import { useNow } from '../time'
import { cx } from '../ui'
import { EntryName, Markers, MovieNotes, otherDates, StateBadges, Standings, TallyBadges } from './bits'
import { upcomingFilter, upcomingQualifiers } from './filter'
import { useSeededQuery } from './filters'
import { airTime, buildDays, daysAway, episodeRange, headingDate, inView, navRows, tally, undatedKey, upcomingKey, views, type Block, type Day, type ViewKey } from './state'
import { gridDays, MonthCalendar, monthEnd, monthOf, monthsBetween, shiftMonth } from './MonthCalendar'
import { AgendaEdge, AgendaTimeline, DayCard, DayHeading, TimelineSkeleton } from './Timeline'
import { TitlePoster } from '../poster'
import { UndatedList, UndatedRow } from './UndatedList'

const BACK = 14
const AHEAD = 60
// The agenda loads a month at a time. It stops at the edge when this many months in a row hold nothing, or at the limit.
const EMPTY_RUN = 3
const LIMIT = 36
// While a scroll is ours (a jump to a day, to today, or keeping the place after a chunk lands), scroll events and the
// month the agenda is over are not the reader's doing.
const LOCK_MS = 600
// A view with a range of its own shows only that range, so it loads nothing more.
const ranged: readonly ViewKey[] = ['next30', 'week', 'recent']

const reasonText = {
  no_air_date: (u: UndatedItem) => `${plural(u.episodes, 'episode')} without an air date`,
  no_release_date: () => 'No release date yet',
  announced: () => 'Announced by TheTVDB, no episodes dated yet',
} as const

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Upcoming({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  // The loaded months, first to last; they only grow, so the agenda never loses what was on screen.
  // They start on the window around today and on the weeks of this month's grid, so its dimmed days carry their dots.
  const [lo, setLo] = useState(() => [monthOf(dayString(-BACK)), monthOf(gridDays(monthOf(dayString()))[0])].sort()[0])
  const [hi, setHi] = useState(() => [monthOf(dayString(AHEAD)), monthOf(gridDays(monthOf(dayString())).at(-1)!)].sort().at(-1)!)
  const months = useMemo(() => monthsBetween(lo, hi), [lo, hi])
  const timeline = useAgendaChunks(useMemo(() => months.map((m) => ({ from: m, to: monthEnd(m) })), [months]))
  const loading = timeline.pending.some(Boolean)
  const queue = useQueue().data ?? []
  const now = useNow()
  useSeededQuery(query, onQuery)
  const passes = useMemo(() => upcomingFilter(query), [query])
  const search = useSearchNow()
  const report = useReport()
  const today = dayString()

  const phone = usePhone()
  // A view narrows the agenda to a range or a state; none chosen shows the whole window.
  const [view, setView] = useState<ViewKey | null>(null)
  const matching = useMemo(() => timeline.items.filter(passes), [timeline.items, passes])
  const counts = useMemo(() => Object.fromEntries(views.map((v) => [v.key, matching.filter((i) => inView(v.key, today, i)).length])) as Record<ViewKey, number>, [matching, today])
  const items = useMemo(() => (view ? matching.filter((i) => inView(view, today, i)) : matching), [matching, view, today])
  const undated = useMemo(() => (view ? [] : timeline.undated.filter(passes)), [timeline.undated, passes, view])
  const chooseView = (v: ViewKey) => setView((now) => (now === v ? null : v))

  // The calendar shows a month; the window grows to cover it. A day is underlined when an entry falls on it.
  const [month, setMonth] = useState(() => monthOf(today))
  // A day the agenda is to scroll to once the months holding it have loaded.
  const [wanted, setWanted] = useState<{ day: string; behavior: ScrollBehavior } | null>(null)
  const releases = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of matching) m.set(localDay(i), (m.get(localDay(i)) ?? 0) + 1)
    return m
  }, [matching])
  const cover = useCallback((first: string, last: string) => {
    setLo((l) => (first < l ? first : l))
    setHi((h) => (last > h ? last : h))
  }, [])
  // Showing a month loads every week its grid shows, so its dimmed days carry their dots too, and brings the agenda to it.
  const showMonth = (next: string) => {
    const grid = gridDays(next)
    cover(monthOf(grid[0]), monthOf(grid[grid.length - 1]))
    setMonth(next)
    setWanted({ day: next, behavior: 'instant' })
  }
  // The agenda scrolling into another month brings the calendar along.
  const followMonth = useCallback(
    (next: string) => {
      const grid = gridDays(next)
      cover(monthOf(grid[0]), monthOf(grid[grid.length - 1]))
      setMonth(next)
    },
    [cover],
  )
  const days = useMemo(() => withToday(buildDays(items), today), [items, today])
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(() => navRows(days, undated, open), [days, undated, open])
  const todayAt = days.findIndex((d) => d.day === today)
  const anchorDay = days[Math.max(0, todayAt - 1)]?.day
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])

  // The cursor starts on the first row of today or later, and stays on its row as rows come and go.
  const [selKey, setSelKey] = useState<string | null>(null)
  const start = Math.max(
    0,
    rows.findIndex((r) => r.day >= today),
  )
  const found = selKey === null ? -1 : (indexOf.get(selKey) ?? -1)
  const sel = found >= 0 ? found : Math.min(start, Math.max(0, rows.length - 1))
  const select = (i: number) => rows[i] && setSelKey(rows[i].key)

  // The view opens on the day before today, so today sits just below the top with the last day above it.
  const anchorRef = useRef<HTMLHeadingElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lockedUntil = useRef(0)
  const touched = useRef(false)
  const lock = (ms = LOCK_MS) => {
    lockedUntil.current = performance.now() + ms
  }
  // Where the first day in view sits, so a chunk that lands above it can be made up for.
  const place = useRef<{ day: string; offset: number } | null>(null)
  const measure = useCallback(() => {
    const box = scrollRef.current
    if (!box) return
    const edge = box.getBoundingClientRect().top
    for (const el of box.querySelectorAll<HTMLElement>('[data-day]')) {
      const top = el.getBoundingClientRect()
      if (top.bottom > edge + 1) {
        place.current = { day: el.dataset.day!, offset: top.top - edge }
        return
      }
    }
    place.current = null
  }, [])
  const scrollTo = (el: Element | null | undefined, behavior: ScrollBehavior) => {
    const box = scrollRef.current
    if (!box || !el) return
    lock(behavior === 'smooth' ? LOCK_MS + 400 : LOCK_MS)
    const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTo?.({ top: Math.max(0, top), behavior })
    if (behavior !== 'smooth') measure()
  }
  const scrollToToday = (behavior: ScrollBehavior) => scrollTo(anchorRef.current, behavior)
  const scrollToDay = (day: string, behavior: ScrollBehavior) => scrollTo(scrollRef.current?.querySelector(`[data-day="${day}"]`), behavior)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (settled || loading) return
    scrollToToday('instant')
    setSettled(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first months have answered
  }, [loading, settled])

  // A chunk that lands above the view pushes it down; put the first day in view back where it was.
  useLayoutEffect(() => {
    const box = scrollRef.current
    const was = place.current
    if (box && was && settled && !wanted) {
      const el = box.querySelector(`[data-day="${was.day}"]`)
      const delta = el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top - was.offset : 0
      if (Math.abs(delta) > 1) {
        lock(150)
        box.scrollTop += delta
      }
    }
    measure()
  }, [days, settled, wanted, measure])

  // Reading the agenda: the first day under the top edge names the month the calendar shows. Not while we scroll ourselves.
  const follow = useRef(followMonth)
  follow.current = followMonth
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const onScroll = () => {
      if (performance.now() >= lockedUntil.current) touched.current = true
      measure()
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [measure])
  useEffect(() => {
    const box = scrollRef.current
    if (!box || typeof IntersectionObserver === 'undefined') return
    const over = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const day = (e.target as HTMLElement).dataset.day!
          if (e.isIntersecting) over.add(day)
          else over.delete(day)
        }
        if (!touched.current || performance.now() < lockedUntil.current || over.size === 0) return
        follow.current(monthOf([...over].sort()[0]))
      },
      { root: box, rootMargin: '0px 0px -75% 0px' },
    )
    for (const el of box.querySelectorAll('[data-day]')) io.observe(el)
    return () => io.disconnect()
  }, [days, settled])

  // Near either end, the next month loads. A view with a range of its own loads nothing; Wanted only looks ahead.
  const topEdge = useRef<HTMLDivElement>(null)
  const bottomEdge = useRef<HTMLDivElement>(null)
  const loadsUp = settled && view === null
  const loadsDown = settled && (view === null || !ranged.includes(view))
  const [near, setNear] = useState({ top: false, bottom: false })
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !settled || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setNear((n) => ({ ...n, [e.target === topEdge.current ? 'top' : 'bottom']: e.isIntersecting }))
      },
      { root: box, rootMargin: '400px 0px' },
    )
    if (topEdge.current) io.observe(topEdge.current)
    if (bottomEdge.current) io.observe(bottomEdge.current)
    return () => io.disconnect()
  }, [settled, loadsUp, loadsDown])
  const empty = (counts: number[]) => counts.length >= EMPTY_RUN && counts.every((n) => n === 0)
  const thisMonth = monthOf(today)
  const topEnd = lo <= shiftMonth(thisMonth, -LIMIT) || empty(timeline.counts.slice(0, EMPTY_RUN))
  const bottomEnd = hi >= shiftMonth(thisMonth, LIMIT) || empty(timeline.counts.slice(-EMPTY_RUN))
  useEffect(() => {
    if (loading || wanted) return
    if (loadsUp && near.top && !topEnd) setLo(shiftMonth(lo, -1))
    else if (loadsDown && near.bottom && !bottomEnd) setHi(shiftMonth(hi, 1))
  }, [loading, wanted, loadsUp, loadsDown, near, topEnd, bottomEnd, lo, hi])

  // A day asked for (the calendar's, a month's first) is scrolled to once the months holding it have loaded: the day
  // itself, or the next one with entries.
  useEffect(() => {
    if (!wanted || loading || !settled) return
    const target = days.find((d) => d.day >= wanted.day)
    if (target) {
      scrollToDay(target.day, wanted.behavior)
      const row = rows.find((r) => r.day === target.day)
      if (row) setSelKey(row.key)
    }
    setWanted(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the request or the loaded data changes
  }, [wanted, loading, settled, days])

  // Another view starts from the top of its own range.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [view])

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
  const jumpToday = () => {
    setSelKey(rows[start]?.key ?? null)
    setMonth(monthOf(today))
    scrollToToday('smooth')
  }
  useKey('t', jumpToday)
  // A day of the calendar scrolls the agenda to that day, or to the next day with entries when nothing is due on it,
  // loading its month first when it is not there yet.
  const goToDay = (day: string) => {
    cover(monthOf(day), monthOf(day))
    if (monthOf(day) !== month) setMonth(monthOf(day))
    setWanted({ day, behavior: 'smooth' })
  }
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('upcoming-filter')?.focus()
  })

  const onSearch = (item: UpcomingItem) => (slots: UpcomingSlot[]) => {
    const scope = item.kind === 'series' && item.episode_id != null ? { season: item.season!, episode_ids: [item.episode_id] } : undefined
    void report(Promise.all(slots.map((slot) => search.mutateAsync({ versionId: slot.version_id, scope }))), { started: `Search started for ${item.title}`, failed: `Could not search ${item.title}` })
  }

  const nothing = timeline.anyData && !loading && items.length === 0 && undated.length === 0
  return (
    <div className={phone ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1'}>
      <SidePanel
        title="Upcoming"
        actions={
          <DotsMenu aria-label="Upcoming actions" width={240}>
            <MenuItem onSelect={jumpToday} description="Scroll the agenda to today (t)">
              Jump to today
            </MenuItem>
          </DotsMenu>
        }
        filter={
          <FilterBar id="upcoming-filter" label="Filter Upcoming" placeholder="Filter titles, e.g. kind:series  /" value={query} onChange={onQuery} qualifiers={upcomingQualifiers} menus={false} />
        }
        controls={
          <FacetFilterButton
            query={query}
            onQuery={onQuery}
            qualifiers={upcomingQualifiers}
            // A phone's panel shows no Views, so they are the first section of its Filter menu.
            lead={
              phone ? (
                <MenuSection title="Views">
                  {views.map((v) => (
                    <MenuItem key={v.key} role="radio" checked={view === v.key} onSelect={() => chooseView(v.key)} suffix={<span className="tabular-nums text-gray-900">{counts[v.key]}</span>}>
                      {v.label}
                    </MenuItem>
                  ))}
                </MenuSection>
              ) : undefined
            }
            leadActive={phone && view ? 1 : 0}
          />
        }
        chips={<FilterChips chips={filterChips(query, onQuery, upcomingQualifiers)} />}
        views={
          <>
            <SidePanelViews>
              {views.map((v) => (
                <SidePanelView key={v.key} current={view === v.key} count={counts[v.key]} onSelect={() => chooseView(v.key)}>
                  {v.label}
                </SidePanelView>
              ))}
            </SidePanelViews>
            <MonthCalendar month={month} today={today} releases={releases} onMonth={showMonth} onPick={goToDay} onToday={jumpToday} />
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col gap-5 px-3 py-6 sm:px-8">
            {timeline.failed && <Note variant="error">Upcoming could not be loaded.</Note>}
            {settled && loadsUp && !nothing && <AgendaEdge edgeRef={topEdge} loading={timeline.pending[0]} end={topEnd} loadingText="Loading earlier days…" endText="Nothing earlier" />}
            {nothing && (
              <div className="my-4">
                {query.trim() === '' ? (
                  <EmptyState description="Nothing is due in this window." />
                ) : (
                  <EmptyState description="Nothing matches the filter.">
                    <Button variant="secondary" size="small" onClick={() => onQuery('')}>
                      Show everything
                    </Button>
                  </EmptyState>
                )}
              </div>
            )}
            {!settled && <TimelineSkeleton />}
            {settled && (
              <AgendaTimeline>
                {days.map((d) => {
                  return (
                    <DayBlock
                      key={d.day}
                      day={d}
                      today={today}
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
                          onSelect={(i) => {
                            select(i)
                            openRow(i)
                          }}
                          onToggleOpen={(k) => setOpen((o) => toggle(o, k))}
                          onSearch={onSearch}
                        />
                      )}
                    />
                  )
                })}
              </AgendaTimeline>
            )}
            {settled && loadsDown && !nothing && (
              <AgendaEdge edgeRef={bottomEdge} loading={timeline.pending[timeline.pending.length - 1]} end={bottomEnd} loadingText="Loading later days…" endText="Nothing later" />
            )}

            {undated.length > 0 && (
              <section aria-labelledby="no-date-yet" className="flex flex-col gap-2">
                <h2 id="no-date-yet" className="heading-16">
                  {`No date yet · ${undated.length}`}
                </h2>
                <UndatedList>
                  {undated.map((u) => {
                    const i = indexOf.get(undatedKey(u)) ?? 0
                    return (
                      <UndatedRow
                        key={undatedKey(u)}
                        index={i}
                        sel={sel}
                        onSelect={() => (select(i), openRow(i))}
                        left={<TitlePoster id={u.title_id} hasPoster={u.has_poster} size="sm" />}
                        right={<Standings title={{ kind: u.kind, title_id: u.title_id, season: null, episode: null }} slots={u.slots} queue={queue} now={now} />}
                      >
                        <Entity.Content
                          fill
                          title={
                            <>
                              {u.title}
                              {u.year ? <span className="font-normal text-gray-900"> {u.year}</span> : null}
                            </>
                          }
                          description={`${u.network ? `${u.network} · ` : ''}${reasonText[u.reason](u)}`}
                        />
                      </UndatedRow>
                    )
                  })}
                </UndatedList>
              </section>
            )}
          </div>
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

function DayBlock({ day, today, headingRef, rowFor }: { day: Day; today: string; headingRef?: React.RefObject<HTMLHeadingElement | null>; rowFor: (b: Block) => React.ReactNode }) {
  const isToday = day.day === today
  const date = headingDate(day.day)
  return (
    <li className="flex flex-col gap-2" data-day={day.day}>
      <DayHeading headingRef={headingRef} date={date} away={daysAway(today, day.day)} isToday={isToday} />
      {day.blocks.length === 0 ? (
        <p className="label-13 text-gray-900">Nothing else is due today.</p>
      ) : (
        <DayCard>
          <Entity.List aria-label={date} className="@container">
            {day.blocks.map((b) => rowFor(b))}
          </Entity.List>
        </DayCard>
      )}
    </li>
  )
}

type RowProps = {
  queue: readonly QueueItem[]
  now: number
  today: string
  sel: number
  indexOf: ReadonlyMap<string, number>
  open: ReadonlySet<string>
  onSelect: (index: number) => void
  onToggleOpen: (key: string) => void
  onSearch: (item: UpcomingItem) => (slots: UpcomingSlot[]) => void
}

function BlockRows({ block, ...p }: { block: Block } & RowProps) {
  if (block.type === 'entry') {
    return <Entry item={block.item} id={block.key} {...p} />
  }
  const first = block.items[0]
  const expanded = p.open.has(block.key)
  const index = p.indexOf.get(block.key) ?? 0
  const at = airTime(first)
  return (
    <>
      <Entity
        as="button"
        current={p.sel === index}
        data-nav={`up-${index}`}
        className={stackedRow}
        rightClassName={stackedRight}
        onClick={() => p.onSelect(index)}
        left={<TitlePoster id={first.title_id} hasPoster={first.has_poster} size="sm" />}
        right={
          <>
            <TallyBadges tallies={tally(block.items, p.queue)} now={p.now} />
            <Button
              variant="tertiary"
              size="tiny"
              svgOnly
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} the ${plural(block.items.length, 'episode')} of ${first.title}`}
              onClick={() => p.onToggleOpen(block.key)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          </>
        }
      >
        <Entity.Content
          fill
          title={
            <>
              <span className="font-semibold">{first.title}</span>{' '}
              <span className="font-normal text-gray-900">
                {episodeRange(block.items)} · {plural(block.items.length, 'episode')}
              </span>
            </>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {first.network && <span>{first.network}</span>}
              {at && <span className="tabular">{at}</span>}
              <Markers markers={[...new Set(block.items.flatMap((i) => i.markers))]} />
            </span>
          }
        />
      </Entity>
      {expanded && block.items.map((item) => <Entry key={upcomingKey(item)} item={item} id={upcomingKey(item)} child {...p} />)}
    </>
  )
}

/** One entry: poster, name, context and state badges. */
function Entry({ item, id, child, ...p }: { item: UpcomingItem; id: string; child?: boolean } & RowProps) {
  const at = airTime(item)
  const others = item.kind === 'movie' ? otherDates(item, p.today) : ''
  const imported = item.slots.length > 0 && item.slots.every((s) => s.state === 'imported')
  const search = p.onSearch(item)
  const index = p.indexOf.get(id) ?? 0
  return (
    <Entity
      as="button"
      current={p.sel === index}
      data-nav={`up-${index}`}
      data-imported={imported || undefined}
      className={cx(stackedRow, imported && 'opacity-60', child && 'pl-10')}
      rightClassName={stackedRight}
      onClick={() => p.onSelect(index)}
      left={child ? undefined : <TitlePoster id={item.title_id} hasPoster={item.has_poster} size="sm" />}
      right={<StateBadges item={item} queue={p.queue} now={p.now} onSearch={search} />}
    >
      <Entity.Content
        fill
        title={<EntryName item={item} />}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.network && <span>{item.network}</span>}
            {at && <span className="tabular">{at}</span>}
            {item.kind === 'movie' ? <MovieNotes item={item} /> : <Markers markers={item.markers} />}
          </span>
        }
      >
        {others && <div className="label-12 text-gray-900">{others}</div>}
      </Entity.Content>
    </Entity>
  )
}
