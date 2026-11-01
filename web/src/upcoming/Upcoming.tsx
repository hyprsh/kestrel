// Upcoming: a timeline around today. Days run from 14 back to 60 ahead (Show more in both directions),
// the view opens at the Today marker, and every entry says where it stands: not out, Wanted, downloading
// or Imported. j/k and Enter move and open (a group opens or closes), and
// `t` goes back to today.
import { Button, DotsMenu, EmptyState, Entity, LoadMoreButton, MenuItem, MenuSection, Note } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchNow } from '../api/grabs'
import { useReport } from '../toasts'
import { useQueue, type QueueItem } from '../api/queue'
import { dayString, localDay, useTimeline, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
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
import { airTime, buildDays, daysAway, episodeRange, headingDate, inView, navRows, tally, undatedKey, upcomingKey, views, weekOf, type Block, type Day, type ViewKey } from './state'
import { gridDays, MonthCalendar, monthOf } from './MonthCalendar'
import { AgendaTimeline, DayHeading, RowDot, TimelineSkeleton, WeekLabel } from './Timeline'
import { TitlePoster } from '../poster'
import { UndatedList, UndatedRow } from './UndatedList'

const BACK = 14
const AHEAD = 60
const MORE_BACK = 30
const MORE_AHEAD = 60

const reasonText = {
  no_air_date: (u: UndatedItem) => `${plural(u.episodes, 'episode')} without an air date`,
  no_release_date: () => 'No release date yet',
  announced: () => 'Announced by TheTVDB, no episodes dated yet',
} as const

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Upcoming({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const [back, setBack] = useState(BACK)
  const [ahead, setAhead] = useState(AHEAD)
  const timeline = useTimeline(back, ahead)
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
  const matching = useMemo(() => (timeline.data?.items ?? []).filter(passes), [timeline.data, passes])
  const counts = useMemo(() => Object.fromEntries(views.map((v) => [v.key, matching.filter((i) => inView(v.key, today, i)).length])) as Record<ViewKey, number>, [matching, today])
  const items = useMemo(() => (view ? matching.filter((i) => inView(view, today, i)) : matching), [matching, view, today])
  const undated = useMemo(() => (view ? [] : (timeline.data?.undated ?? []).filter(passes)), [timeline.data, passes, view])
  const chooseView = (v: ViewKey) => setView((now) => (now === v ? null : v))

  // The calendar shows a month; the window grows to cover it. A day is underlined when an entry falls on it.
  const [month, setMonth] = useState(() => monthOf(today))
  const releases = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of matching) m.set(localDay(i), (m.get(localDay(i)) ?? 0) + 1)
    return m
  }, [matching])
  // Moving to another month widens the window to the weeks it shows, so its days can be underlined.
  const showMonth = (next: string) => {
    const grid = gridDays(next)
    const apart = (day: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
    setBack((b) => Math.max(b, apart(grid[0])))
    setAhead((a) => Math.max(a, -apart(grid[grid.length - 1])))
    setMonth(next)
  }
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
  const jumpToday = () => {
    setSelKey(rows[start]?.key ?? null)
    scrollToToday('smooth')
  }
  useKey('t', jumpToday)
  // A day of the calendar scrolls the agenda to that day, or to the next day with entries when nothing is due on it.
  const goToDay = (day: string) => {
    const target = days.find((d) => d.day >= day)
    const box = scrollRef.current
    const heading = target && box?.querySelector(`[data-day="${target.day}"]`)
    if (!target || !box || !heading) return
    const top = box.scrollTop + heading.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' })
    const row = rows.find((r) => r.day === target.day)
    if (row) setSelKey(row.key)
  }
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('upcoming-filter')?.focus()
  })

  const onSearch = (item: UpcomingItem) => (slots: UpcomingSlot[]) => {
    const scope = item.kind === 'series' && item.episode_id != null ? { season: item.season!, episode_ids: [item.episode_id] } : undefined
    void report(Promise.all(slots.map((slot) => search.mutateAsync({ versionId: slot.version_id, scope }))), { started: `Search started for ${item.title}`, failed: `Could not search ${item.title}` })
  }

  const empty = timeline.data && items.length === 0 && undated.length === 0
  let lastWeek = ''
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
            <MonthCalendar month={month} today={today} releases={releases} onMonth={showMonth} onPick={goToDay} />
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div className="px-3 pb-8 sm:px-8">
            {timeline.isError && <Note variant="error">Upcoming could not be loaded.</Note>}
            {timeline.data && (
              <LoadMoreButton noGap variant="tertiary" size="small" loading={timeline.isFetching} onClick={() => setBack((b) => b + MORE_BACK)} className="mt-2">
                Show earlier
              </LoadMoreButton>
            )}
            {empty && (
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
            {timeline.isPending && <TimelineSkeleton />}
            {!timeline.isPending && (
              <AgendaTimeline>
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
  const date = headingDate(day.day)
  return (
    <>
      {week && <WeekLabel week={week} />}
      <li className="relative" data-day={day.day}>
        <DayHeading headingRef={headingRef} date={date} away={daysAway(today, day.day)} isToday={isToday} />
        {day.blocks.length === 0 ? (
          <p className="label-12 pb-2 pl-9 text-gray-900">Nothing else is due today.</p>
        ) : (
          <div className="pr-3 pb-2 pl-9">
            <Entity.List aria-label={date} className="@container overflow-visible">
              {day.blocks.map((b) => rowFor(b))}
            </Entity.List>
          </div>
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
              <span className="font-medium">{first.title}</span>{' '}
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
        >
          <RowDot />
        </Entity.Content>
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
        {!child && <RowDot />}
        {others && <div className="label-12 text-gray-900">{others}</div>}
      </Entity.Content>
    </Entity>
  )
}
