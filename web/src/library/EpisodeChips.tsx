import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { placePath, useOpenPlace } from '../place'
import type { EpisodeActions } from './EpisodeActions'
import { EpisodeFilePopover } from './EpisodeFilePopover'
import { grabOf } from './cellDetail'
import { episodeCode } from './episodes'
import { SlotChips, type ChipData } from './SlotChip'
import { SlotPopover, type SlotAction } from './SlotPopover'
import { cellOf, type SlotInfo } from './slots'
import { slotDetail } from './slotDetail'

/**
 * An episode's chips, one per Slot, each a button whose popover is that Slot alone: a file's details (with Upgrade Search), the
 * last search of a Wanted Slot with Search and Manual Search, a download's progress with View in Activity, or Monitor for one
 * that is not monitored. A Slot the Title has no Version in is a plain chip.
 */
export function EpisodeChips({
  episode,
  slots,
  grabs,
  actions,
  max,
  wrap,
  align,
  tabIndex,
}: {
  episode: Episode
  slots: SlotInfo[]
  grabs: Map<string, QueueItem>
  actions: EpisodeActions
  max: number
  wrap?: boolean
  align?: 'start' | 'end'
  tabIndex?: number
}) {
  const openPlace = useOpenPlace()
  const code = episodeCode(episode)
  const scope = { season: episode.season, episode_ids: [episode.id] }
  const chips: ChipData[] = slots.map((s) => {
    const grab = grabOf(grabs, s.key, episode)
    const d = slotDetail(episode, s.key, grab)
    const cell = cellOf(episode, s.key)
    const base = { key: s.key, short: s.short, state: d.state, tip: d.tip }
    if (!cell) return base
    const label = `${code} ${s.name}`
    const heading = `${code} · ${s.name}`
    const version = actions.versions.find((v) => v.slot === s.key)
    if (cell.file) {
      const file = cell.file
      return {
        ...base,
        wrap: (trigger) => (
          <EpisodeFilePopover label={label} heading={heading} cell={cell} file={file} trigger={trigger} onUpgrade={version ? () => actions.manual(version, scope, code) : undefined} />
        ),
      }
    }
    const act: SlotAction[] = []
    const lines: string[] = []
    if (d.state === 'wanted') {
      act.push({ label: 'Search', primary: true, run: () => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }), s.key) })
      if (version) act.push({ label: 'Manual Search', run: () => actions.manual(version, scope, code) })
    }
    if (d.state === 'downloading') act.push({ label: 'View in Activity', primary: true, run: () => openPlace(placePath('activity')) })
    if (d.state === 'unmonitored') act.push({ label: 'Monitor', primary: true, run: () => actions.monitor([episode], true) })
    if (d.note) lines.push(d.state === 'wanted' ? d.note.charAt(0).toUpperCase() + d.note.slice(1) : d.note)
    return {
      ...base,
      wrap: (trigger) => <SlotPopover label={label} heading={heading} state={d.state} text={d.text} lines={lines} actions={act} trigger={trigger} />,
    }
  })
  return <SlotChips chips={chips} max={max} wrap={wrap} align={align} tabIndex={tabIndex} label={`${code} Slots`} />
}
