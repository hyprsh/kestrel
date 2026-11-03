// chrome: domain-visual
import type { ReactNode } from 'react'
import type { Episode } from '../api/queries'
import type { EpisodeActions } from './EpisodeActions'
import { AccordionList, AccordionRow, BarCell, Chevron, Count, CountCell, lineRow, phoneRow, RowName, SizeCell, StandingText } from './accordion'
import { EpisodeDeleteConfirm } from './DeleteFiles'
import { MonitorToggle } from './MonitorToggle'
import { SeasonActions } from './EpisodeActions'
import { SlotPills, type ChipData } from './SlotPills'
import { seasonName, seasonRow, slotTally, tallyCount, type SlotTally } from './episodes'
import { combinedState, type Combined, type SlotInfo } from './slots'
import { barColor, chipsShown, StateBar, type BarPart } from './StateBar'
import { usePhone } from '../responsive'
import { plural } from '../format'

/** The bar's colour of each combined episode state. */
const stateColor: Record<Combined, string> = {
  filled: barColor.filled,
  partial: barColor.wanted,
  wanted: barColor.wanted,
  long_missing: barColor.longMissing,
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
  const long = n('long_missing')
  const downloading = n('downloading')
  const unaired = n('unreleased')
  const off = n('unmonitored')
  const off_ = off > 0 ? `${off} not monitored` : null
  if (wanted > 0 || long > 0 || downloading > 0) {
    const parts = [wanted > 0 ? `${wanted} Wanted` : null, long > 0 ? `${long} Long Missing` : null, downloading > 0 ? `${downloading} downloading` : null, off_].filter(Boolean)
    return { text: parts.join(' \u00b7 '), tone: long > 0 ? 'text-red-900' : wanted > 0 ? 'text-amber-900' : 'text-blue-900' }
  }
  if (off > 0) return { text: off_!, tone: 'text-gray-900' }
  if (unaired === states.length) return { text: 'Not aired', tone: 'text-gray-900' }
  return { text: unaired > 0 ? `Complete \u00b7 ${unaired} not aired` : 'Complete', tone: 'text-gray-900' }
}

/** The year of a season's first air date ("2024"), or null when no episode has one. */
const firstYear = (eps: Episode[]): string | null => {
  const dates = eps.map((e) => e.air_date).filter((d): d is string => !!d)
  return dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)).slice(0, 4) : null
}

/**
 * The seasons as an accordion: a row per season on one line (its monitoring bookmark, its name with "19 episodes · 2024", its
 * state in words, a bar of its episodes by state, their have/aired count, or a chip per Slot with its count when there are
 * several), and opens its episodes in place. The size column is kept empty so the bars line up with the Versions' above. At the
 * row's end sit its actions (Search Season and a ⋯ menu; a phone has the menu alone), the same open or closed.
 * `body` draws an open season's episodes. A season that is not monitored is dimmed.
 */
export function SeasonAccordion({
  seasons,
  episodes,
  slots,
  open,
  onToggle,
  actions,
  onSelectAll,
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
        const bar: BarPart[] = (['filled', 'partial', 'wanted', 'long_missing', 'downloading', 'unreleased', 'unmonitored'] as Combined[]).map((k) => ({
          key: k,
          n: states.filter((s) => s === k).length,
          color: stateColor[k],
        }))
        const complete = eps.length > 0 && states.every((s) => s === 'filled')
        // One Slot: its count as mono text beside the bar. Several: a chip per Slot (short name, state dot, count).
        const meta = [eps.length > 0 ? plural(eps.length, 'episode') : null, firstYear(eps)].filter(Boolean).join(' \u00b7 ')
        const lone = tallies.length === 1 && !(tallies[0].counted === 0 && tallies[0].filled === 0) ? tallies[0] : null
        const count = monitored ? (
          lone ? (
            <Count text={`${lone.filled}/${lone.counted}`} tip={say(lone, slots[0].name)} />
          ) : tallies.length > 1 ? (
            <SlotPills chips={tallies.map((t, i) => tallyChip(t, monitored, slots[i]))} max={chipsShown} />
          ) : null
        ) : null
        const rowActions = <SeasonActions actions={actions} season={n} episodes={eps} monitored={monitored} phone={phone} onSelectAll={() => onSelectAll(n)} />
        return (
          <div key={n} data-monitored={monitored ? 'on' : 'off'} data-season={n}>
            <AccordionRow
              label={`${name}: ${line.text}${monitored ? `, ${tallies.map((t, i) => say(t, slots[i].name)).join('; ')}` : ''}`}
              open={isOpen}
              onToggle={() => onToggle(n)}
              rowClass={phone ? phoneRow : lineRow}
              header={
                phone ? (
                  <>
                    <Chevron open={isOpen} />
                    <RowName name={name} meta={meta} dim={!monitored} />
                    {rowActions}
                    <span className="pointer-events-none col-start-2 col-end-4 mt-1 flex min-w-0 items-center gap-2">
                      <StandingText text={line.text} tone={line.tone} className="flex-1" />
                      <BarCell className="w-24">
                        <StateBar parts={bar} complete={complete} />
                      </BarCell>
                      {lone && <Count text={`${lone.filled}/${lone.counted}`} tip={say(lone, slots[0].name)} />}
                    </span>
                  </>
                ) : (
                  <>
                    <Chevron open={isOpen} />
                    <span className="relative flex">
                      <MonitorToggle name={name} monitored={monitored} onToggle={() => actions.monitorSeason(n, !monitored)} />
                    </span>
                    <RowName name={name} meta={meta} dim={!monitored} />
                    <StandingText text={line.text} tone={line.tone} />
                    <BarCell>
                      <StateBar parts={bar} complete={complete} />
                    </BarCell>
                    <CountCell>{count}</CountCell>
                    <SizeCell text="" />
                    {rowActions}
                  </>
                )
              }
              below={<EpisodeDeleteConfirm deletes={actions.deletes} at={seasonRow(n)} />}
              body={<div className="border-t border-gray-alpha-200 bg-background-100">{body(n)}</div>}
            />
          </div>
        )
      })}
    </AccordionList>
  )
}
