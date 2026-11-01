// chrome: domain-visual
import { useState } from 'react'
import type { Episode } from '../api/queries'
import { EpisodeDeleteConfirm } from './DeleteFiles'
import { SeasonMenu, SeasonSearch, type EpisodeActions } from './EpisodeActions'
import { rowActionsShown } from './IconAction'
import { slotLabel, type SlotKey } from './bits'
import { seasonName, seasonRow, slotTally, tallyCount, type SlotTally } from './episodes'

/** The square of each episode state, and what the legend calls it. */
const squares: Record<string, { className: string; label: string }> = {
  filled: { className: 'bg-green-700', label: 'Have' },
  wanted: { className: 'bg-amber-700', label: 'Wanted' },
  downloading: { className: 'bg-blue-700', label: 'Downloading' },
  unreleased: { className: 'bg-gray-300', label: 'Not aired' },
  unmonitored: { className: 'shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]', label: 'Not monitored' },
}
const legend = ['filled', 'wanted', 'downloading', 'unreleased', 'unmonitored']

const square = 'size-[11px] shrink-0 rounded-[2px]'

const shortSlot: Record<SlotKey, string> = { standard: 'STD', '4k': '4K' }

/** A Slot's row of a season in words, for the row's name and the strip's tooltip: "Standard 8 of 10, 2 downloading, 6 not aired". */
function say(t: SlotTally): string {
  if (t.counted === 0 && t.filled === 0) return `${slotLabel[t.slot]} ${tallyCount(t)}`
  const parts = [`${slotLabel[t.slot]} ${t.filled} of ${t.counted}`]
  if (t.wanted > 0) parts.push(`${t.wanted} Wanted`)
  if (t.downloading > 0) parts.push(`${t.downloading} downloading`)
  if (t.unaired > 0) parts.push(`${t.unaired} not aired`)
  return parts.join(', ')
}

/**
 * Seasons at a glance: a row per season with, per Slot, a square for each episode coloured by its state, and the count in words.
 * A row opens its season below; the open one is highlighted. The squares are decoration: the row's name carries the counts.
 */
export function SeasonGrid({
  seasons,
  episodes,
  slots,
  open,
  onOpen,
  actions,
}: {
  seasons: number[]
  episodes: Map<number, Episode[]>
  slots: SlotKey[]
  open: number
  onOpen: (season: number) => void
  actions: EpisodeActions
}) {
  const [menuSeason, setMenuSeason] = useState<number | null>(null)
  return (
    <section aria-label="Seasons" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="heading-16">Seasons</h3>
        <div aria-hidden className="label-12 flex flex-wrap gap-x-3.5 gap-y-1 text-gray-900">
          {legend.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`${square} ${squares[k].className}`} />
              {squares[k].label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md shadow-border">
        {seasons.map((n) => {
          const tallies = slots.map((s) => slotTally(episodes.get(n) ?? [], s))
          const name = seasonName(n)
          const isOpen = n === open
          return (
            <div key={n} className="border-b border-gray-alpha-200 last:border-b-0">
              <div data-menu-open={menuSeason === n ? '' : undefined} className={`group/row flex items-start hover:bg-gray-100 ${isOpen ? 'bg-gray-100' : ''}`}>
                <button
                  type="button"
                  aria-label={`${name}: ${tallies.map(say).join('; ')}${isOpen ? ', open' : ''}`}
                  aria-current={isOpen ? 'true' : undefined}
                  onClick={() => onOpen(n)}
                  className={`flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-2 pl-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-color)`}
                >
                  <span className={`label-14 w-16 shrink-0 whitespace-nowrap ${isOpen ? 'font-semibold' : ''}`}>{name}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {tallies.map((t) => (
                      <span key={t.slot} title={say(t)} className="flex min-w-0 items-start gap-3">
                        <span className="label-12-mono w-9 shrink-0 text-gray-900 max-sm:w-7">{shortSlot[t.slot]}</span>
                        <span aria-hidden className="flex min-w-0 flex-1 flex-wrap gap-[3px] pt-px">
                          {t.states.map((s, i) => (
                            <span key={i} className={`${square} ${squares[s]?.className ?? squares.unmonitored.className}`} />
                          ))}
                        </span>
                        <span className={`label-12 hy-num shrink-0 text-right ${t.wanted > 0 ? 'text-amber-900' : 'text-gray-900'}`}>{tallyCount(t)}</span>
                      </span>
                    ))}
                  </span>
                </button>
                <span className={`flex shrink-0 items-center gap-1 py-1.5 pr-2 pl-2 max-sm:gap-0 max-sm:pl-1 max-sm:pr-1 ${rowActionsShown}`}>
                  <SeasonSearch actions={actions} season={n} episodes={episodes.get(n) ?? []} />
                  <SeasonMenu actions={actions} season={n} episodes={episodes.get(n) ?? []} onOpenChange={(o) => setMenuSeason(o ? n : null)} />
                </span>
              </div>
              <EpisodeDeleteConfirm deletes={actions.deletes} at={seasonRow(n)} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
