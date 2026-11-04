// What a cell of the season table offers, built from the table's actions (EpisodeActions.tsx): the items of the menu (a bottom sheet on a
// phone) of one Version in one season or one episode, and how the cell reads (its kind and its count).
import { Activity, BookmarkCheck, ListFilter, Search } from 'lucide-react'
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { placePath, useOpenPlace } from '../place'
import type { CellItem, CellKind } from './CellButton'
import type { EpisodeActions } from './EpisodeActions'
import { episodeCode, seasonName, type EpisodeVersion, type SlotTally } from './episodes'
import { cellOf } from './slots'

/** How a cell reads: the kind sets its colour, `count` is what sits beside the dot ("6", "—"). */
export type CellView = {
  kind: CellKind
  count: string
  /** What it says in words, for its name. */ say: string
  /** What a wide screen shows beside the dot in place of `count`: a downloading episode's "40%". */ wideCount?: string
}

/** One Version's cell in a season: a check when it has the whole season, else the state that needs a look. */
export function seasonCellView(t: SlotTally, monitored: boolean): CellView {
  const empty = t.counted === 0 && t.filled === 0
  if (!monitored) return { kind: 'off', count: '—', say: 'Not monitored' }
  if (t.wanted > 0) return { kind: 'wanted', count: String(t.wanted), say: `${t.wanted} Wanted` }
  if (t.downloading > 0) return { kind: 'downloading', count: String(t.downloading), say: `${t.downloading} downloading` }
  if (empty) {
    const out = t.unaired > 0 && t.unmonitored === 0
    return out ? { kind: 'out', count: '—', say: 'Not out yet' } : { kind: 'off', count: '—', say: 'Not monitored' }
  }
  return { kind: 'done', count: '', say: `${t.filled} of ${t.counted}` }
}

/** One Version's cell of an episode: null for a Slot the Title has no Version in. */
export function episodeCellView(e: Episode, slot: string, grab: QueueItem | undefined): CellView | null {
  const cell = cellOf(e, slot)
  if (!cell) return null
  switch (cell.state as string) {
    case 'filled':
      return { kind: 'done', count: '', say: 'Have' }
    case 'wanted': {
      const text = cell.long_missing ? 'Long Missing' : 'Wanted'
      return { kind: 'wanted', count: '', say: text }
    }
    case 'downloading': {
      const pct = grab && grab.bytes_total > 0 ? percent(grab.bytes_total, grab.phase === 'importing' ? 0 : grab.bytes_left) : null
      return { kind: 'downloading', count: pct === null ? '' : String(pct), wideCount: pct === null ? undefined : `${pct}%`, say: pct === null ? 'Downloading' : `Downloading ${pct}%` }
    }
    case 'unreleased':
      return { kind: 'out', count: '—', say: 'Not out yet' }
    default:
      return { kind: 'off', count: '—', say: 'Not monitored' }
  }
}

/** The builders of the items of a season cell's and an episode cell's menu. */
export function useCellItems(actions: EpisodeActions) {
  const openPlace = useOpenPlace()
  const activity: CellItem = { label: 'Open in Activity', sub: 'See the download', icon: Activity, onSelect: () => openPlace(placePath('activity')) }
  return {
    /** `onShowWanted` filters the table to the season's Wanted episodes. */
    season(v: EpisodeVersion, season: number, eps: Episode[], t: SlotTally, monitored: boolean, onShowWanted: (season: number) => void): CellItem[] {
      const name = seasonName(season)
      const items: CellItem[] = []
      if (t.wanted > 0) {
        items.push({
          label: `Search ${name} for ${v.slotName}`,
          sub: `Asks the indexers for the ${t.wanted === 1 ? 'Wanted episode' : `${t.wanted} Wanted episodes`}`,
          icon: Search,
          onSelect: () => actions.search(eps, name, () => ({ season }), v.slot),
        })
      }
      // Always there, aired or not, monitored or not: a Release can be picked by hand for any season.
      items.push({ label: `Manual Search ${name} (${v.slotName})…`, sub: 'Pick a Release yourself', icon: ListFilter, onSelect: () => actions.manual(v, { season }, name) })
      if (t.wanted > 0) {
        items.push({
          label: t.wanted === 1 ? 'Show the Wanted Episode' : `Show the ${t.wanted} Wanted Episodes`,
          sub: 'Filter the table to them',
          icon: ListFilter,
          onSelect: () => onShowWanted(season),
        })
      }
      if (t.downloading > 0) items.push(activity)
      if (!monitored) items.push({ label: `Monitor ${name}`, sub: 'Search for its episodes again', icon: BookmarkCheck, onSelect: () => actions.monitorSeason(season, true) })
      return items
    },
    episode(v: EpisodeVersion, e: Episode, view: CellView): CellItem[] {
      const code = episodeCode(e)
      const scope = { season: e.season, episode_ids: [e.id] }
      const manual: CellItem = { label: `Manual Search ${code} (${v.slotName})…`, sub: 'Pick a Release yourself', icon: ListFilter, onSelect: () => actions.manual(v, scope, code) }
      switch (view.kind) {
        case 'wanted':
          return [
            {
              label: `Search ${code} for ${v.slotName}`,
              sub: 'Asks the indexers for it',
              icon: Search,
              onSelect: () => actions.search([e], code, (ids) => ({ season: e.season, episode_ids: ids }), v.slot),
            },
            manual,
          ]
        case 'downloading':
          return [manual, activity]
        case 'off':
          return [manual, { label: `Monitor ${code}`, sub: 'Search for it again', icon: BookmarkCheck, onSelect: () => actions.monitor([e], true) }]
        default:
          return [manual]
      }
    },
  }
}
