// chrome: domain-visual
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Episode } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { CellButton } from './CellButton'
import { EpisodeDeleteConfirm } from './DeleteFiles'
import { SeasonMenu, type EpisodeActions } from './EpisodeActions'
import { monthDay } from './cellDetail'
import { seasonCellView, useCellItems } from './cellItems'
import { seasonName, seasonRow, slotTally, tallyCount, type SlotTally } from './episodes'
import { combinedState, type Combined, type SlotInfo } from './slots'
import { gridOf } from './tableGrid'

/** A Version's row of a season in words, for the row's name: "Standard 8 of 10, 2 downloading, 6 not aired". */
function say(t: SlotTally, name: string): string {
  if (t.counted === 0 && t.filled === 0) return `${name} ${tallyCount(t)}`
  const parts = [`${name} ${t.filled} of ${t.counted}`]
  if (t.wanted > 0) parts.push(`${t.wanted} Wanted`)
  if (t.downloading > 0) parts.push(`${t.downloading} downloading`)
  if (t.unaired > 0) parts.push(`${t.unaired} not aired`)
  return parts.join(', ')
}

/**
 * What a season says about itself in one line, for the name of its row: "Complete" (only when nothing in it is unmonitored),
 * "6 Wanted · 6 downloading", "5 not monitored", "Not aired", "Not monitored" (nothing in it is monitored).
 */
function standing(states: Combined[], monitored: boolean): string {
  if (!monitored) return 'Not monitored'
  const n = (...ks: Combined[]) => states.filter((s) => ks.includes(s)).length
  const wanted = n('wanted', 'partial')
  const long = n('long_missing')
  const downloading = n('downloading')
  const unaired = n('unreleased')
  const off = n('unmonitored')
  const off_ = off > 0 ? `${off} not monitored` : null
  if (wanted > 0 || long > 0 || downloading > 0) {
    return [wanted > 0 ? `${wanted} Wanted` : null, long > 0 ? `${long} Long Missing` : null, downloading > 0 ? `${downloading} downloading` : null, off_].filter(Boolean).join(' · ')
  }
  if (off > 0) return off_!
  if (unaired === states.length) return 'Not aired'
  return unaired > 0 ? `Complete · ${unaired} not aired` : 'Complete'
}

/** A season's air years as its row says them: "2008", "2012–2013", or "from Sep 29" while nothing in it has aired. */
function years(eps: Episode[], now: number): string | null {
  const dates = eps
    .map((e) => e.air_date)
    .filter((d): d is string => !!d)
    .sort()
  if (dates.length === 0) return null
  const first = dates[0]
  if (new Date(`${first}T00:00:00Z`).getTime() > now) return `from ${monthDay(first)}`
  const [a, b] = [first.slice(0, 4), dates[dates.length - 1].slice(0, 4)]
  return a === b ? a : `${a}–${b}`
}

/**
 * The seasons as rows of the table, aligned to its Version columns: the season's name with "19 episodes · 2024", then a cell per Version
 * (a quiet check when the Version has the whole season, else a dot and what is Wanted or downloading, a button with that Version's menu for
 * the season) and the row's ⋯ menu, season-wide. The name opens the season's episodes in place (`body` draws them). A season that is not
 * monitored has its name dimmed, never its cells or ⋯. `onShowWanted` filters the table to a season's Wanted episodes.
 */
export function SeasonRows({
  seasons,
  episodes,
  slots,
  open,
  onToggle,
  actions,
  onSelectAll,
  onShowWanted,
  now,
  body,
}: {
  seasons: number[]
  episodes: Map<number, Episode[]>
  slots: SlotInfo[]
  open: ReadonlySet<number>
  onToggle: (season: number) => void
  actions: EpisodeActions
  /** Ticks every episode of a season (opening it first when it is closed). */
  onSelectAll: (season: number) => void
  onShowWanted: (season: number) => void
  now: number
  body: (season: number) => ReactNode
}) {
  const phone = usePhone()
  const items = useCellItems(actions)
  const keys = slots.map((s) => s.key)
  const grid = gridOf(slots.length, phone)
  return (
    <>
      {seasons.map((n) => {
        const eps = episodes.get(n) ?? []
        const name = seasonName(n)
        const monitored = eps.some((e) => e.monitored)
        const states = eps.map((e) => (e.monitored ? combinedState(e, keys) : 'unmonitored'))
        const tallies = slots.map((s) => slotTally(eps, s.key))
        const isOpen = open.has(n)
        const meta = [eps.length > 0 ? plural(eps.length, 'episode') : null, years(eps, now)].filter(Boolean).join(' · ')
        const label = `${name}: ${standing(states, monitored)}${monitored ? `, ${tallies.map((t, i) => say(t, slots[i].name)).join('; ')}` : ''}`
        return (
          <div key={n} role="presentation" data-monitored={monitored ? 'on' : 'off'} data-season={n} data-open={isOpen ? '' : undefined} className="border-t border-gray-alpha-200">
            {/* A click anywhere in the row opens or closes the season, except on its buttons and in the menus they open (portals, outside the row). */}
            <div
              role="row"
              style={grid.style}
              className={`${grid.className} ${phone ? 'min-h-14 px-1.5 py-2' : 'min-h-16'} cursor-pointer hover:bg-gray-alpha-100 ${isOpen ? 'bg-gray-alpha-100' : ''}`}
              onClick={(e) => {
                const target = e.target as HTMLElement
                if (e.currentTarget.contains(target) && !target.closest('button, a, input')) onToggle(n)
              }}
            >
              <span role="rowheader" className={`flex min-w-0 items-center ${phone ? '' : 'pr-2 pl-3'}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={label}
                  onClick={() => onToggle(n)}
                  className={`flex min-w-0 cursor-pointer items-center rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-color) ${phone ? 'gap-2' : 'gap-3'}`}
                >
                  <ChevronRight aria-hidden className={`size-4 shrink-0 text-gray-900 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="flex min-w-0 flex-col gap-0.5 text-left">
                    <span className={`${phone ? 'label-14' : 'text-[15px]'} label-14-strong ${monitored ? '' : 'text-gray-900 opacity-75'}`}>{name}</span>
                    <span className={`${phone ? 'label-12' : 'label-13'} truncate text-gray-900 ${monitored ? '' : 'opacity-75'}`}>{meta}</span>
                  </span>
                </button>
              </span>
              {slots.map((s, i) => {
                const v = actions.versions.find((x) => x.slot === s.key)
                const view = seasonCellView(tallies[i], monitored)
                const cellItems = v ? items.season(v, n, eps, tallies[i], monitored, onShowWanted) : []
                const cellLabel = `${name}, ${s.name}: ${view.say}`
                return (
                  <span key={s.key} role="cell" className="flex min-w-0 items-center justify-center max-sm:border-l max-sm:border-gray-alpha-200">
                    {v && <CellButton kind={view.kind} count={view.count} label={cellLabel} title={`${name} · ${s.name}`} status={view.say} items={cellItems} phone={phone} />}
                  </span>
                )
              })}
              <span role="cell" className={`flex items-center justify-center`}>
                <SeasonMenu actions={actions} season={n} episodes={eps} monitored={monitored} onSelectAll={() => onSelectAll(n)} />
              </span>
            </div>
            <EpisodeDeleteConfirm deletes={actions.deletes} at={seasonRow(n)} />
            {isOpen && body(n)}
          </div>
        )
      })}
    </>
  )
}
