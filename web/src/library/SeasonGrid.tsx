// chrome: domain-visual
import { useState } from 'react'
import type { Episode } from '../api/queries'
import { EpisodeDeleteConfirm } from './DeleteFiles'
import { SeasonMenu, SeasonSearch, type EpisodeActions } from './EpisodeActions'
import { rowActionsShown } from './IconAction'
import { MonitorToggle } from './MonitorToggle'
import { seasonName, seasonRow, slotTally, tallyCount, type SlotTally } from './episodes'
import { combinedState, slotName, slotShort, type Combined, type SlotInfo } from './slots'

/** The square of each combined episode state, and what the legend calls it. */
const squares: Record<Combined, { className: string; label: string }> = {
  filled: { className: 'bg-green-700', label: 'Every Slot has it' },
  partial: { className: 'bg-[linear-gradient(135deg,var(--green-700)_50%,var(--amber-700)_50%)]', label: 'Some Slots Wanted' },
  wanted: { className: 'bg-amber-700', label: 'All Wanted' },
  downloading: { className: 'bg-blue-700', label: 'Downloading' },
  unreleased: { className: 'bg-gray-300', label: 'Not aired' },
  unmonitored: { className: 'shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]', label: 'Not monitored' },
}
const legend: Combined[] = ['filled', 'partial', 'wanted', 'downloading', 'unreleased', 'unmonitored']

const square = 'size-[11px] shrink-0 rounded-[2px]'

/** A Slot's row of a season in words, for the row's name and the strip's tooltip: "Standard 8 of 10, 2 downloading, 6 not aired". */
function say(t: SlotTally): string {
  if (t.counted === 0 && t.filled === 0) return `${slotName(t.slot)} ${tallyCount(t)}`
  const parts = [`${slotName(t.slot)} ${t.filled} of ${t.counted}`]
  if (t.wanted > 0) parts.push(`${t.wanted} Wanted`)
  if (t.downloading > 0) parts.push(`${t.downloading} downloading`)
  if (t.unaired > 0) parts.push(`${t.unaired} not aired`)
  return parts.join(', ')
}

/**
 * Seasons at a glance: a row per season with the monitoring bookmark, its name, ONE strip of squares (each an episode's
 * combined state over every Slot, whatever their number) and a chip per Slot with its count ("STD 8/10", amber while
 * Wanted). A season that is not monitored is dimmed and says so. The row opens its season below; the open one is
 * highlighted. The squares are decoration: the row's name carries the counts.
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
  slots: SlotInfo[]
  open: number
  onOpen: (season: number) => void
  actions: EpisodeActions
}) {
  const [menuSeason, setMenuSeason] = useState<number | null>(null)
  const keys = slots.map((s) => s.key)
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
          const eps = episodes.get(n) ?? []
          const tallies = slots.map((s) => slotTally(eps, s.key))
          const name = seasonName(n)
          const isOpen = n === open
          const monitored = eps.some((e) => e.monitored)
          const states = eps.map((e) => (e.monitored ? combinedState(e, keys) : 'unmonitored'))
          const counts = tallies.map(say).join('; ')
          return (
            <div key={n} data-monitored={monitored ? 'on' : 'off'} className="border-b border-gray-alpha-200 last:border-b-0">
              <div data-menu-open={menuSeason === n ? '' : undefined} className={`group/row flex items-center hover:bg-gray-100 ${isOpen ? 'bg-gray-100' : ''} ${monitored ? '' : 'opacity-55'}`}>
                <span className="shrink-0 pl-2.5">
                  <MonitorToggle name={name} monitored={monitored} onToggle={() => actions.monitorSeason(n, !monitored)} />
                </span>
                <button
                  type="button"
                  aria-label={`${name}: ${monitored ? counts : 'not monitored'}${isOpen ? ', open' : ''}`}
                  aria-current={isOpen ? 'true' : undefined}
                  onClick={() => onOpen(n)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-color) max-sm:flex-wrap"
                >
                  <span className={`label-14 w-[72px] shrink-0 whitespace-nowrap ${isOpen ? 'font-semibold' : ''}`}>{name}</span>
                  <span title={counts} aria-hidden className="flex min-w-0 flex-1 flex-wrap gap-[3px] pt-px">
                    {states.map((s, i) => (
                      <span key={i} data-square={s} className={`${square} ${squares[s].className}`} />
                    ))}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-sm:w-full max-sm:justify-start">
                    {monitored ? (
                      tallies.map((t) => (
                        <span
                          key={t.slot}
                          title={say(t)}
                          data-wanted={t.wanted > 0 ? '' : undefined}
                          className={`label-12 hy-num inline-flex h-[22px] items-center rounded-full bg-gray-100 px-2 whitespace-nowrap ${t.wanted > 0 ? 'text-amber-900' : 'text-gray-900'}`}
                        >
                          {slotShort(t.slot)} {t.counted === 0 && t.filled === 0 ? tallyCount(t) : `${t.filled}/${t.counted}`}
                        </span>
                      ))
                    ) : (
                      <span className="label-12 text-gray-900">not monitored</span>
                    )}
                  </span>
                </button>
                <span className={`flex shrink-0 items-center gap-1 pr-2 pl-2 max-sm:gap-0 max-sm:pl-1 max-sm:pr-1 ${rowActionsShown}`}>
                  <SeasonSearch actions={actions} season={n} episodes={eps} />
                  <SeasonMenu actions={actions} season={n} episodes={eps} onOpenChange={(o) => setMenuSeason(o ? n : null)} />
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
