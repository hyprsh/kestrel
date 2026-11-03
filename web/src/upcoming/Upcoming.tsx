// Upcoming: the agenda, week by week around today, or the month. The agenda opens on the months from 14 days back to 60 ahead and loads a month more
// when the reader nears either end; the side panel's calendar, the week header and the agenda follow each other. Every entry says
// where it stands: waiting for its release, downloading, Imported, out and not found, or not monitored. j/k and Enter move and open,
// and `t` goes back to today.
import { Button, DotsMenu, EmptyState, Entity, MenuItem, MenuSection, NavItem, Note } from '@hyprsh/design'
import { useVirtualizer } from '@tanstack/react-virtual'
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
import { FilterChips, SidePanel, SidePanelViews } from '../layout/SidePanel'
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
import {
  addDays,
  buildSegments,
  daysAway,
  headingDate,
  inView,
  navRows,
  undatedKey,
  upcomingKey,
  views,
  weekStart,
  weekRange,
  weekStats,
  weekTitle,
  statusCache,
  type Segment,
  type ViewKey,
} from './state'
import { AgendaEdge, AgendaTimeline, DAY_GAP, DayBlock, DayCard, PhoneDay, QuietLine, TimelineSkeleton, WeekHeader } from './Timeline'
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

/** What a day block or quiet line is estimated to take until it is drawn and measured. */
const ROW_ESTIMATE = { phone: 64, desktop: 58 }
const DAY_HEAD = { phone: 32, desktop: 8 }
const QUIET_ESTIMATE = { phone: 36, desktop: 30 }
/** Day blocks drawn above and below what shows. */
const OVERSCAN = 5
/** A day with more rows than this is drawn in parts of this many, so that one day of hundreds of entries is not drawn whole. */
const PART_ROWS = 24
/** A day or quiet line of the agenda, or a part of a day with many rows: what the windowing draws and measures. */
type Unit = { key: string; seg: Segment; items: UpcomingItem[]; part: 'only' | 'first' | 'middle' | 'last' }
const unitsOf = (segments: readonly Segment[]): Unit[] =>
  segments.flatMap((seg): Unit[] => {
    if (seg.type === 'quiet' || seg.items.length <= PART_ROWS) return [{ key: seg.key, seg, items: seg.type === 'quiet' ? [] : seg.items, part: 'only' }]
    const parts = Math.ceil(seg.items.length / PART_ROWS)
    return Array.from({ length: parts }, (_, n) => ({
      key: n === 0 ? seg.key : `${seg.key}#${n}`,
      seg,
      items: seg.items.slice(n * PART_ROWS, (n + 1) * PART_ROWS),
      part: n === 0 ? 'first' : n === parts - 1 ? 'last' : 'middle',
    }))
  })
const estimateUnit = (unit: Unit | undefined, phone: boolean) => {
  const k = phone ? 'phone' : 'desktop'
  if (!unit || unit.seg.type === 'quiet') return QUIET_ESTIMATE[k] + (phone ? 0 : DAY_GAP)
  return (unit.part === 'only' || unit.part === 'first' ? DAY_HEAD[k] : 0) + unit.items.length * ROW_ESTIMATE[k] + (phone ? 0 : unit.part === 'only' || unit.part === 'last' ? DAY_GAP : 0)
}

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
  // Only the days near the view are drawn (a Library of thousands has thousands of entries in a few months), with the height of
  // the rest as padding. A scroller that cannot be measured (jsdom, or it has no height yet) draws every day.
  const nothing = display === 'agenda' && timeline.anyData && !loading && items.length === 0 && undated.length === 0
  const units = useMemo(() => (nothing ? [] : unitsOf(segments)), [nothing, segments])
  const listRef = useRef<HTMLOListElement>(null)
  // The agenda opens on today (the first block that is not over), once its months have answered and it has been drawn.
  const positioned = useRef(false)
  const [listTop, setListTop] = useState(0)
  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateUnit(units[i], phone),
    getItemKey: (i) => units[i]?.key ?? i,
    overscan: OVERSCAN,
    scrollMargin: listTop,
    // Measured only after the first commit: until then the scroller is taken to be as tall as the window.
    initialRect: { width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight },
  })
  const virtualItems = virtualizer.getVirtualItems() // sets `scrollRect` from `initialRect` before it is measured
  const windowed = (virtualizer.scrollRect?.height ?? 0) > 0
  const drawn = windowed ? virtualItems.map((v) => v.index) : units.map((_, i) => i)
  const rangeKey = drawn.length > 0 ? `${drawn[0]}-${drawn[drawn.length - 1]}` : ''
  useLayoutEffect(() => {
    const list = listRef.current
    const box = scrollRef.current
    if (!list || !box) return
    list.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => virtualizer.measureElement(el))
    const top = list.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    setListTop((t) => (Math.abs(t - top) > 1 ? top : t))
  })
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
  const scrollToTop = (top: number, behavior: ScrollBehavior) => {
    const box = scrollRef.current
    if (!box) return
    lock(behavior === 'smooth' ? LOCK_MS + 400 : LOCK_MS)
    box.scrollTo?.({ top: Math.max(0, top), behavior })
    if (behavior !== 'smooth') measure()
  }
  const scrollTo = (el: Element | null | undefined, behavior: ScrollBehavior) => {
    const box = scrollRef.current
    if (!box || !el) return
    scrollToTop(box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top, behavior)
  }
  // The block that holds a day, or the next one after it: a day with nothing is inside a quiet line.
  const blockFor = (day: string) => segments.find((s) => s.to >= day)
  // Where a day is to land: a day that is drawn is at its place; one that is not is scrolled to by the estimate, and then put right
  // (see `landing`) once it and the days above it have been drawn and measured.
  const landing = useRef<{ from: string; until: number } | null>(null)
  const scrollToDay = (day: string, behavior: ScrollBehavior) => {
    const at = units.findIndex((u) => u.seg.to >= day)
    if (at < 0) return
    const seg = units[at].seg
    const el = scrollRef.current?.querySelector(`[data-day="${seg.from}"]`)
    if (el) return scrollTo(el, behavior)
    const top = virtualizer.measurementsCache[at]?.start
    if (top === undefined) return
    landing.current = { from: seg.from, until: performance.now() + LOCK_MS }
    scrollToTop(top, 'instant')
  }
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!loading) setSettled(true)
  }, [loading])
  // The agenda opens on today (the first block that is not over), once its months have answered and it has been drawn.
  useLayoutEffect(() => {
    if (!settled || display !== 'agenda' || positioned.current || !scrollRef.current) return
    positioned.current = true
    scrollToDay(today, 'instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first months have answered
  }, [settled, display])

  // A day scrolled to by the estimate is put right once it is drawn: the days above it have their measured heights by then.
  useLayoutEffect(() => {
    const box = scrollRef.current
    const to = landing.current
    if (!box || !to) return
    if (performance.now() > to.until) {
      landing.current = null
      return
    }
    const el = box.querySelector(`[data-day="${to.from}"]`)
    if (!el) return
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top
    if (Math.abs(delta) > 1) {
      lock(150)
      box.scrollTop += delta
    }
  })

  // A chunk that lands above the view pushes it down; put the first day in view back where it was. A day that is not drawn
  // any more is found by its place among the days.
  useLayoutEffect(() => {
    const box = scrollRef.current
    const was = place.current
    if (box && was && settled && !wanted) {
      const el = box.querySelector(`[data-day="${was.day}"]`)
      let delta = 0
      if (el) delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top - was.offset
      else {
        const at = units.findIndex((u) => u.seg.from === was.day)
        const top = at >= 0 ? virtualizer.measurementsCache[at]?.start : undefined
        if (top !== undefined) delta = top - was.offset - box.scrollTop
      }
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
  }, [segments, settled, display, rangeKey])

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
  // The cursor's row may be one that is not drawn: its day is scrolled into view first, and the row follows once it is drawn.
  const cursorDay = rows[sel]?.day
  const cursorKey = rows[sel]?.key
  const reached = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (!windowed || !settled || !positioned.current || !cursorDay || reached.current === sel) return
    const row = document.querySelector(`[data-nav="up-${sel}"]`)
    if (row) {
      reached.current = sel
      row.scrollIntoView?.({ block: 'nearest' })
      return
    }
    const at = units.findIndex((u) => u.items.some((i) => upcomingKey(i) === cursorKey))
    const box = scrollRef.current
    const item = at >= 0 ? virtualizer.measurementsCache[at] : undefined
    if (!box || !item) return
    if (item.start < box.scrollTop) scrollToTop(item.start, 'instant')
    else if (item.end > box.scrollTop + box.clientHeight) scrollToTop(Math.min(item.start, item.end - box.clientHeight), 'instant')
  })
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

  const statusOf = useMemo(() => statusCache(queue), [queue])
  const stats = useMemo(() => weekStats(items, week, statusOf), [items, week, statusOf])
  // The days not drawn above and below, as padding.
  const padding =
    windowed && virtualItems.length > 0
      ? { paddingTop: Math.max(0, virtualItems[0].start - listTop), paddingBottom: Math.max(0, virtualizer.getTotalSize() + listTop - virtualItems[virtualItems.length - 1].end) }
      : undefined
  const row = (item: UpcomingItem) => {
    const key = upcomingKey(item)
    const index = indexOf.get(key) ?? 0
    return (
      <AgendaRow
        key={key}
        item={item}
        queue={queue}
        status={statusOf(item)}
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
        filter={<FilterBar id="upcoming-filter" label="Filter Upcoming" placeholder="Filter titles, e.g. kind:series  /" value={query} onChange={onQuery} qualifiers={upcomingFacets} menus={false} />}
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
                <NavItem key={v.key} icon={viewIcons[v.key]} current={view === v.key ? 'true' : false} trailing={counts[v.key]} onClick={() => setView(v.key)}>
                  {v.label}
                </NavItem>
              ))}
            </SidePanelViews>
            {agenda && <MonthCalendar month={month} today={today} week={week} releases={releases} onMonth={showMonth} onPick={goToDay} />}
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {display === 'month' && (
          <MonthView month={month} today={today} items={items} statusOf={statusOf} onMonth={showMonth} onToday={() => showMonth(monthOf(today))} onDay={agendaAt} onOpenTitle={onOpenTitle} />
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
                <AgendaTimeline compact={phone} listRef={listRef} style={padding} spaced={false}>
                  {drawn.map((i) => {
                    const { seg, items: part, part: which, key } = units[i]
                    const head = which === 'only' || which === 'first'
                    // A day's parts carry its date once (`data-day`); the others only say which unit they are.
                    const mark = { ...(head ? { 'data-day': seg.from, 'data-week': seg.week } : {}), 'data-index': String(i) }
                    if (seg.type === 'quiet') return <QuietLine key={key} text={seg.text} compact={phone} padded {...mark} />
                    const away = daysAway(today, seg.from)
                    const label = headingDate(seg.from)
                    const padded = which === 'only' || which === 'last'
                    return phone ? (
                      <PhoneDay key={key} heading={label} away={away} continued={!head} {...mark}>
                        <ul aria-label={label}>{part.map(row)}</ul>
                      </PhoneDay>
                    ) : (
                      <DayBlock key={key} day={seg.from} num={Number(seg.from.slice(8))} away={away} isToday={seg.from === today} continued={!head} padded={padded} {...mark}>
                        <DayCard label={label} part={which}>
                          {part.map(row)}
                        </DayCard>
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
