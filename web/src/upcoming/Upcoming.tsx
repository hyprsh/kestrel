// Upcoming: the agenda, week by week around today, or the month. The agenda opens on the months from 14 days back to 60 ahead and loads a month more
// when the reader nears either end; the side panel's calendar, the week header and the agenda follow each other. Every entry says
// where it stands: waiting for its release, downloading, Imported, out and not found, or not monitored. j/k and Enter move and open,
// and `t` goes back to today.
import { Button, DotsMenu, EmptyState, Entity, MenuItem, MenuSection, Note } from '@hyprsh/design'
import { CalendarDays, Clock, EyeOff, History } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchNow } from '../api/grabs'
import { useReport } from '../toasts'
import { useQueue } from '../api/queue'
import { dayString, localDay, useAgendaChunks, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
import { plural } from '../format'
import { useKey, useListNav } from '../keys'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import { FacetFilterButton } from '../layout/FilterButton'
import { FilterChips, SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { AgendaRow } from './AgendaRow'
import { Standings } from './bits'
import { DisplayButton, useDisplayMode } from './displayMode'
import { upcomingFilter, upcomingQualifiers } from './filter'
import { useSlotNames } from '../library/slots'
import { useSeededQuery } from './filters'
import { gridDays, MonthCalendar, monthEnd, monthOf, monthsBetween, shiftMonth } from './MonthCalendar'
import { MonthView } from './MonthView'
import { addDays, buildSegments, daysAway, headingDate, inView, navRows, undatedKey, upcomingKey, views, weekStart, weekRange, weekStats, weekTitle, type ViewKey } from './state'
import { AgendaEdge, AgendaTimeline, DayBlock, DayCard, PhoneDay, QuietLine, TimelineSkeleton, WeekHeader } from './Timeline'
import { TitlePoster } from '../poster'
import { UndatedList, UndatedRow } from './UndatedList'
import { WeekStrip } from './WeekStrip'

const BACK = 14
const AHEAD = 60
// The agenda loads a month at a time. It stops at the edge when this many months in a row hold nothing, or at the limit.
const EMPTY_RUN = 3
const LIMIT = 36
// While a scroll is ours (a jump to a day, to today, or keeping the place after a chunk lands), scroll events and the
// week the agenda is over are not the reader's doing.
const LOCK_MS = 600

// A Views row's icon.
const viewIcons: Record<ViewKey, React.ReactNode> = { all: <CalendarDays />, wanted: <Clock />, recent: <History />, unmonitored: <EyeOff /> }

const reasonText = {
  no_air_date: (u: UndatedItem) => `${plural(u.episodes, 'episode')} without an air date`,
  no_release_date: () => 'No release date yet',
  announced: () => 'Announced by TheTVDB, no episodes dated yet',
} as const

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
/** How many Titles with no date show at first, and how many each "Show more" adds. */
const UNDATED_FIRST = 100
const UNDATED_MORE = 200

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
  const slotNames = useSlotNames()
  const upcomingFacets = useMemo(() => upcomingQualifiers(slotNames), [slotNames])
  const passes = useMemo(() => upcomingFilter(query, slotNames), [query, slotNames])
  const search = useSearchNow()
  const report = useReport()
  const today = dayString()

  const phone = usePhone()
  const [chosen, setDisplay] = useDisplayMode()
  // A phone has no Month.
  const display = phone ? 'agenda' : chosen
  // A view narrows the entries to a state or a range; Everything is the whole window.
  const [view, setView] = useState<ViewKey>('all')
  const matching = useMemo(() => timeline.items.filter(passes), [timeline.items, passes])
  const counts = useMemo(() => Object.fromEntries(views.map((v) => [v.key, matching.filter((i) => inView(v.key, today, i)).length])) as Record<ViewKey, number>, [matching, today])
  const items = useMemo(() => matching.filter((i) => inView(view, today, i)), [matching, view, today])
  const undated = useMemo(() => (view === 'all' ? timeline.undated.filter(passes) : []), [timeline.undated, passes, view])

  // The calendar shows a month; the window grows to cover it. A day is dotted when an entry falls on it.
  const [month, setMonth] = useState(() => monthOf(today))
  // The day the agenda is at (the first one under its top edge, or the one asked for): its week is the one the header and the
  // calendar show.
  const [shown, setShown] = useState(today)
  const week = weekStart(shown, today)
  // A day the agenda is to scroll to once the months holding it have loaded.
  const [wanted, setWanted] = useState<{ day: string; behavior: ScrollBehavior } | null>(null)
  const releases = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(localDay(i), (m.get(localDay(i)) ?? 0) + 1)
    return m
  }, [items])
  const cover = useCallback((first: string, last: string) => {
    setLo((l) => (first < l ? first : l))
    setHi((h) => (last > h ? last : h))
  }, [])
  // Showing a month loads every week its grid shows, so its dimmed days carry their dots too, and brings the agenda to it.
  const showMonth = (next: string) => {
    const grid = gridDays(next)
    cover(monthOf(grid[0]), monthOf(grid[grid.length - 1]))
    setMonth(next)
    setShown(next)
    setWanted({ day: next, behavior: 'instant' })
  }
  // The agenda scrolling to another day brings the calendar and the header along.
  const followDay = useCallback(
    (day: string) => {
      const next = monthOf(day)
      const grid = gridDays(next)
      cover(monthOf(grid[0]), monthOf(grid[grid.length - 1]))
      setMonth(next)
      setShown(day)
    },
    [cover],
  )
  const segments = useMemo(() => buildSegments(items, today), [items, today])
  const rows = useMemo(() => navRows(items, undated), [items, undated])
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])
  // The Titles with no date can be thousands: the first of them show, and the rest on request or once the cursor reaches them.
  const [undatedShown, setUndatedShown] = useState(UNDATED_FIRST)

  // The cursor starts on the first row of today or later, and stays on its row as rows come and go.
  const [selKey, setSelKey] = useState<string | null>(null)
  const start = Math.max(
    0,
    rows.findIndex((r) => r.day >= today),
  )
  const found = selKey === null ? -1 : (indexOf.get(selKey) ?? -1)
  const sel = found >= 0 ? found : Math.min(start, Math.max(0, rows.length - 1))
  const select = (i: number) => rows[i] && setSelKey(rows[i].key)

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
  // The block that holds a day, or the next one after it: a day with nothing is inside a quiet line.
  const blockFor = (day: string) => segments.find((s) => s.to >= day)
  const scrollToDay = (day: string, behavior: ScrollBehavior) => {
    const seg = blockFor(day)
    if (seg) scrollTo(scrollRef.current?.querySelector(`[data-day="${seg.from}"]`), behavior)
  }
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!loading) setSettled(true)
  }, [loading])
  // The agenda opens on today (the first block that is not over), once its months have answered and it has been drawn.
  const positioned = useRef(false)
  useLayoutEffect(() => {
    if (!settled || display !== 'agenda' || positioned.current || !scrollRef.current) return
    positioned.current = true
    scrollToDay(today, 'instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first months have answered
  }, [settled, display])

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
  }, [segments, settled, wanted, measure])

  // Reading the agenda: the first day under the top edge names the week the header and the calendar show. Not while we scroll ourselves.
  const follow = useRef(followDay)
  follow.current = followDay
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const onScroll = () => {
      if (performance.now() >= lockedUntil.current) touched.current = true
      measure()
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [measure, display, settled])
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
        follow.current([...over].sort()[0])
      },
      { root: box, rootMargin: '0px 0px -75% 0px' },
    )
    for (const el of box.querySelectorAll('[data-day]')) io.observe(el)
    return () => io.disconnect()
  }, [segments, settled, display])

  // Near either end, the next month loads. Recently out looks at the past fortnight only and loads nothing; Wanted only looks ahead.
  const topEdge = useRef<HTMLDivElement>(null)
  const bottomEdge = useRef<HTMLDivElement>(null)
  const agenda = display === 'agenda'
  const loadsUp = settled && agenda && (view === 'all' || view === 'unmonitored')
  const loadsDown = settled && agenda && view !== 'recent'
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

  // A day asked for (the calendar's, a week's first) is scrolled to once the months holding it have loaded: the block that
  // holds it, or the next one with entries.
  useEffect(() => {
    if (!wanted || loading || !settled) return
    if (agenda) {
      const seg = blockFor(wanted.day)
      if (seg) {
        scrollToDay(wanted.day, wanted.behavior)
        const row = rows.find((r) => r.day >= wanted.day && r.day !== '')
        if (row) setSelKey(row.key)
      }
    }
    setWanted(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the request or the loaded data changes
  }, [wanted, loading, settled, segments, agenda])

  // Another view starts from the top of its own range.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [view])

  const openRow = (i: number) => {
    const row = rows[i]
    if (row) onOpenTitle(row.titleId)
  }
  useListNav('up', rows.length, sel, select, openRow)
  const jumpToday = () => {
    setSelKey(rows[start]?.key ?? null)
    setMonth(monthOf(today))
    setShown(today)
    if (agenda) scrollToDay(today, 'smooth')
    else setWanted({ day: today, behavior: 'instant' })
  }
  useKey('t', jumpToday)
  // A day of the calendar (or a week's first) scrolls the agenda to that day, or to the next day with entries when nothing is due
  // on it, loading its months first when they are not there yet. The header names its week at once.
  const goToDay = (day: string) => {
    cover(monthOf(day), monthOf(addDays(day, 6)))
    setMonth(monthOf(day))
    setShown(day)
    setWanted({ day, behavior: 'smooth' })
  }
  // The Month display's day number and "+N more" switch to the Agenda at that day.
  const agendaAt = (day: string) => {
    setDisplay('agenda')
    positioned.current = true
    cover(monthOf(day), monthOf(addDays(day, 6)))
    setMonth(monthOf(day))
    setShown(day)
    setWanted({ day, behavior: 'instant' })
  }
  const changeDisplay = (next: 'agenda' | 'month') => {
    if (next === 'agenda') agendaAt(shown)
    else setDisplay(next)
  }
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('upcoming-filter')?.focus()
  })

  const onSearch = (item: UpcomingItem) => (slots: UpcomingSlot[]) => {
    const scope = item.kind === 'series' && item.episode_id != null ? { season: item.season!, episode_ids: [item.episode_id] } : undefined
    void report(Promise.all(slots.map((slot) => search.mutateAsync({ versionId: slot.version_id, scope }))), { started: `Search started for ${item.title}`, failed: `Could not search ${item.title}` })
  }

  const nothing = agenda && timeline.anyData && !loading && items.length === 0 && undated.length === 0
  const stats = useMemo(() => weekStats(items, week, queue), [items, week, queue])
  const row = (item: UpcomingItem) => {
    const key = upcomingKey(item)
    const index = indexOf.get(key) ?? 0
    return (
      <AgendaRow
        key={key}
        item={item}
        queue={queue}
        today={today}
        now={now}
        current={sel === index}
        index={index}
        compact={phone}
        onOpen={() => (select(index), onOpenTitle(item.title_id))}
        onSearch={onSearch(item)}
      />
    )
  }
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
          <FilterBar id="upcoming-filter" label="Filter Upcoming" placeholder="Filter titles, e.g. kind:series  /" value={query} onChange={onQuery} qualifiers={upcomingFacets} menus={false} />
        }
        controls={
          <>
            <FacetFilterButton
              query={query}
              onQuery={onQuery}
              qualifiers={upcomingFacets}
              label={phone ? 'Views and filter' : undefined}
              // A phone's panel shows no Views, so they are the first section of its Filter menu.
              lead={
                phone ? (
                  <MenuSection title="Views">
                    {views.map((v) => (
                      <MenuItem key={v.key} role="radio" checked={view === v.key} onSelect={() => setView(v.key)} suffix={<span className="tabular-nums text-gray-900">{counts[v.key]}</span>}>
                        {v.label}
                      </MenuItem>
                    ))}
                  </MenuSection>
                ) : undefined
              }
              leadActive={phone && view !== 'all' ? 1 : 0}
            />
            {!phone && <DisplayButton mode={display} onMode={changeDisplay} />}
          </>
        }
        chips={
          <>
            <FilterChips chips={filterChips(query, onQuery, upcomingFacets)} />
            {phone && <WeekStrip week={week} today={today} shown={shown} releases={releases} onPick={goToDay} />}
          </>
        }
        views={
          <>
            <SidePanelViews>
              {views.map((v) => (
                <SidePanelView key={v.key} icon={viewIcons[v.key]} current={view === v.key} count={counts[v.key]} onSelect={() => setView(v.key)}>
                  {v.label}
                </SidePanelView>
              ))}
            </SidePanelViews>
            {agenda && <MonthCalendar month={month} today={today} week={week} releases={releases} onMonth={showMonth} onPick={goToDay} />}
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {display === 'month' && (
          <MonthView month={month} today={today} items={items} queue={queue} onMonth={showMonth} onToday={() => showMonth(monthOf(today))} onDay={agendaAt} onOpenTitle={onOpenTitle} />
        )}
        {agenda && !phone && (
          <WeekHeader title={weekTitle(today, week)} range={weekRange(week)} stats={stats} onPrev={() => goToDay(addDays(week, -7))} onToday={jumpToday} onNext={() => goToDay(addDays(week, 7))} />
        )}
        {agenda && (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <div className="flex flex-col gap-5 p-4 sm:px-8 sm:py-3">
              {timeline.failed && <Note variant="error">Upcoming could not be loaded.</Note>}
              {settled && loadsUp && !nothing && <AgendaEdge edgeRef={topEdge} loading={timeline.pending[0]} end={topEnd} loadingText="Loading earlier days…" endText="Nothing earlier" />}
              {nothing && (
                <div className="my-4">
                  {query.trim() === '' && view === 'all' ? (
                    <EmptyState description="Nothing is due in this window." />
                  ) : (
                    <EmptyState description={view === 'all' ? 'Nothing matches the filter.' : 'Nothing in this view.'}>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          onQuery('')
                          setView('all')
                        }}
                      >
                        Show everything
                      </Button>
                    </EmptyState>
                  )}
                </div>
              )}
              {!settled && <TimelineSkeleton />}
              {settled && (
                <AgendaTimeline compact={phone}>
                  {(nothing ? [] : segments).map((seg) => {
                    const mark = { 'data-day': seg.from, 'data-week': seg.week }
                    if (seg.type === 'quiet') return <QuietLine key={seg.key} text={seg.text} compact={phone} {...mark} />
                    const away = daysAway(today, seg.from)
                    const label = headingDate(seg.from)
                    return phone ? (
                      <PhoneDay key={seg.key} heading={label} away={away} {...mark}>
                        <ul aria-label={label}>{seg.items.map(row)}</ul>
                      </PhoneDay>
                    ) : (
                      <DayBlock key={seg.key} day={seg.from} num={Number(seg.from.slice(8))} away={away} isToday={seg.from === today} {...mark}>
                        <DayCard label={label}>{seg.items.map(row)}</DayCard>
                      </DayBlock>
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
                    {undated.slice(0, Math.max(undatedShown, sel - items.length + 1)).map((u) => {
                      const i = indexOf.get(undatedKey(u)) ?? 0
                      return (
                        <UndatedRow
                          key={undatedKey(u)}
                          index={i}
                          sel={sel}
                          onSelect={() => (select(i), openRow(i))}
                          left={<TitlePoster id={u.title_id} hasPoster={u.has_poster} size="sm" />}
                          right={<Standings title={{ kind: u.kind, title_id: u.title_id, season: null, episode: null }} slots={u.slots} queue={queue} />}
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
                  {undated.length > Math.max(undatedShown, sel - items.length + 1) && (
                    <Button variant="tertiary" size="small" onClick={() => setUndatedShown((n) => n + UNDATED_MORE)}>
                      {`Show ${Math.min(UNDATED_MORE, undated.length - undatedShown)} more`}
                    </Button>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
