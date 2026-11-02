// chrome: domain-visual
import type { ReactNode } from 'react'
import type { Episode } from '../api/queries'
import type { EpisodeActions } from './EpisodeActions'
import { AccordionList, AccordionRow, Chevron } from './accordion'
import { MonitorToggle } from './MonitorToggle'
import { SlotChips, type ChipData } from './SlotChip'
import { seasonName, slotTally, tallyCount, type SlotTally } from './episodes'
import { combinedState, type Combined, type SlotInfo } from './slots'
import { barColor, chipsShown, rowColumns, StateBar, type BarPart } from './StateBar'
import { usePhone } from '../responsive'
import { plural } from '../format'

/** The bar's colour of each combined episode state. */
const stateColor: Record<Combined, string> = {
  filled: barColor.filled,
  partial: barColor.wanted,
  wanted: barColor.wanted,
  downloading: barColor.downloading,
  unreleased: barColor.quiet,
  unmonitored: barColor.quiet,
}

/** A Slot's row of a season in words, for the row's name and the chip's tooltip: "Standard 8 of 10, 2 downloading, 6 not aired". */
function say(t: SlotTally, name: string): string {
  if (t.counted === 0 && t.filled === 0) return `${name} ${tallyCount(t)}`
  const parts = [`${name} ${t.filled} of ${t.counted}`]
  if (t.wanted > 0) parts.push(`${t.wanted} Wanted`)
  if (t.downloading > 0) parts.push(`${t.downloading} downloading`)
  if (t.unaired > 0) parts.push(`${t.unaired} not aired`)
  return parts.join(', ')
}

/** The chip of one Slot in one season: "STD 8/10" with the dot of the worst state in it. */
function tallyChip(t: SlotTally, monitored: boolean, slot: SlotInfo): ChipData {
  const empty = t.counted === 0 && t.filled === 0
  const state = !monitored ? 'unmonitored' : t.wanted > 0 ? 'wanted' : t.downloading > 0 ? 'downloading' : empty ? (t.unaired > 0 && t.unmonitored === 0 ? 'unreleased' : 'unmonitored') : 'filled'
  return { key: t.slot, short: slot.short, state, text: empty ? undefined : `${t.filled}/${t.counted}`, tip: say(t, slot.name) }
}

/**
 * What a season says about itself in one line, apart from its chip's count: "Complete" (only when nothing in it is unmonitored),
 * "6 Wanted · 6 downloading", "5 not monitored", "Not aired", "Not monitored" (nothing in it is monitored).
 */
function standing(states: Combined[], monitored: boolean): { text: string; tone: string } {
  if (!monitored) return { text: 'Not monitored', tone: 'text-gray-900' }
  const n = (...ks: Combined[]) => states.filter((s) => ks.includes(s)).length
  const wanted = n('wanted', 'partial')
  const downloading = n('downloading')
  const unaired = n('unreleased')
  const off = n('unmonitored')
  const off_ = off > 0 ? `${off} not monitored` : null
  if (wanted > 0 || downloading > 0) {
    const parts = [wanted > 0 ? `${wanted} Wanted` : null, downloading > 0 ? `${downloading} downloading` : null, off_].filter(Boolean)
    return { text: parts.join(' \u00b7 '), tone: wanted > 0 ? 'text-amber-900' : 'text-blue-900' }
  }
  if (off > 0) return { text: off_!, tone: 'text-gray-900' }
  if (unaired === states.length) return { text: 'Not aired', tone: 'text-gray-900' }
  return { text: unaired > 0 ? `Complete \u00b7 ${unaired} not aired` : 'Complete', tone: 'text-gray-900' }
}

/**
 * The seasons as an accordion: a row per season that says it all closed (its monitoring bookmark, a bar of its episodes by
 * state with a line under it, a chip per Slot with have/aired counts, the episode count), and opens its episodes in place.
 * `body` draws an open season's tools and episodes. A season that is not monitored is dimmed.
 */
export function SeasonAccordion({
  seasons,
  episodes,
  slots,
  open,
  onToggle,
  actions,
  body,
}: {
  seasons: number[]
  episodes: Map<number, Episode[]>
  slots: SlotInfo[]
  open: ReadonlySet<number>
  onToggle: (season: number) => void
  actions: EpisodeActions
  body: (season: number) => ReactNode
}) {
  const phone = usePhone()
  const keys = slots.map((s) => s.key)
  return (
    <AccordionList label="Seasons">
      {seasons.map((n) => {
        const eps = episodes.get(n) ?? []
        const name = seasonName(n)
        const monitored = eps.some((e) => e.monitored)
        const states = eps.map((e) => (e.monitored ? combinedState(e, keys) : 'unmonitored'))
        const tallies = slots.map((s) => slotTally(eps, s.key))
        const line = standing(states, monitored)
        const isOpen = open.has(n)
        const bar: BarPart[] = (['filled', 'partial', 'downloading', 'unreleased', 'unmonitored'] as Combined[]).map((k) => ({ key: k, n: states.filter((s) => s === k).length, color: stateColor[k] }))
        const complete = eps.length > 0 && states.every((s) => s === 'filled')
        // The chip counts what is Have; the trailing figure is the season's episodes, said only when it is not the chip's own total.
        const total = tallies.some((t) => t.counted !== eps.length) ? plural(eps.length, 'ep') : ''
        return (
          <div key={n} data-monitored={monitored ? 'on' : 'off'} data-season={n}>
            <AccordionRow
              label={`${name}: ${line.text}${monitored ? `, ${tallies.map((t, i) => say(t, slots[i].name)).join('; ')}` : ''}`}
              open={isOpen}
              onToggle={() => onToggle(n)}
              gridClass={phone ? 'grid-cols-[16px_minmax(0,1fr)] min-h-14 py-2.5' : rowColumns}
              header={
                phone ? (
                  <>
                    <Chevron open={isOpen} />
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className={`label-14 font-semibold ${monitored ? '' : 'text-gray-900'}`}>{name}</span>
                      <StateBar parts={bar} complete={complete} />
                      <span className={`label-12 truncate ${line.tone}`}>{line.text}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Chevron open={isOpen} />
                    <span className="relative">
                      <MonitorToggle name={name} monitored={monitored} onToggle={() => actions.monitorSeason(n, !monitored)} />
                    </span>
                    <span className={`label-14 font-semibold ${monitored ? '' : 'text-gray-900'}`}>{name}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <StateBar parts={bar} complete={complete} />
                      <span className={`label-12 truncate ${line.tone}`}>{line.text}</span>
                    </span>
                    <span className="relative flex justify-end gap-1.5">{monitored && <SlotChips chips={tallies.map((t, i) => tallyChip(t, monitored, slots[i]))} max={chipsShown} />}</span>
                    <span className="label-12 pointer-events-none text-right text-gray-900 tabular-nums">{total}</span>
                  </>
                )
              }
              body={<div className="border-t border-gray-alpha-200 bg-background-100">{body(n)}</div>}
            />
          </div>
        )
      })}
    </AccordionList>
  )
}
