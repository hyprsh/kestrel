import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Episode } from '../api/queries'
import { Button } from '../forms'
import { slotLabel, type SlotKey } from './bits'
import type { SeasonOpen } from './useSeasonOpen'

/**
 * A season header's disclosure: the season's name with a chevron, which shows
 * or hides its episode rows. It is not one of the grid's tab stops; the
 * keyboard opens and closes a season with Enter, Right and Left on its header.
 */
export function SeasonToggle({ name, open, onToggle, onFocus }: { name: string; open: boolean; onToggle: () => void; onFocus: () => void }) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${name} episodes`}
      tabIndex={-1}
      onFocus={onFocus}
      onClick={onToggle}
      className="flex items-center gap-1 rounded font-medium outline-none hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700"
    >
      <Chevron aria-hidden className="size-3.5 text-gray-900" />
      {name}
    </button>
  )
}

/**
 * How a closed season stands: its episode count and air years, and per Slot
 * how many episodes are filled and Wanted. An episode cell is never
 * downloading (the Grab shows in "Downloading now"), so that is not counted.
 */
export function SeasonSummary({ episodes, slots }: { episodes: Episode[]; slots: SlotKey[] }) {
  const years = episodes.flatMap((e) => (e.air_date ? [Number(e.air_date.slice(0, 4))] : []))
  const from = Math.min(...years)
  const to = Math.max(...years)
  const aired = years.length === 0 ? '' : from === to ? ` · ${from}` : ` · ${from}–${to}`
  const count = (s: SlotKey, state: string) => episodes.filter((e) => e.cells[s]?.state === state).length
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-[12px] text-gray-900">
      <span>
        {episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'}
        {aired}
      </span>
      {slots.map((s) => {
        const wanted = count(s, 'wanted')
        return (
          <span key={s}>
            {slotLabel[s]} {count(s, 'filled')}/{episodes.length} filled
            {wanted > 0 && `, ${wanted} Wanted`}
          </span>
        )
      })}
    </span>
  )
}

/** "Expand all" and "Collapse all" for a Series' seasons, above the episode grid. */
export function SeasonToolbar({ seasons }: { seasons: SeasonOpen }) {
  if (seasons.seasons.length === 0) return null
  const button = (label: string, open: boolean) => (
    <Button type="button" variant="secondary" onClick={() => seasons.setAll(open)} className="h-7 px-2 text-[12px]">
      {label}
    </Button>
  )
  return (
    <div className="flex items-center gap-1">
      {button('Expand all', true)}
      {button('Collapse all', false)}
    </div>
  )
}
