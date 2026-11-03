// What the opened episode row and the chips' tooltips say of one Slot's cell: its state in words, the file or search line
// beside it, the size and the one action. Built from the cell and the queue's Grab only (see cellDetail.ts).
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { size } from './bits'
import { cellText, monthDay } from './cellDetail'
import { stateWord } from './SlotPills'
import { cellOf } from './slots'
import { lastSearchLine } from './WantedLine'

export type SlotDetail = {
  key: string
  name: string
  /** The cell's state, null when the Title has no Version in the Slot. */
  state: string | null
  /** "1080p · 1.6 GB", "Wanted · 7 d", "40% · 13 min". */
  text: string
  /** The file's path, for a filled Slot: shown cut at its start. */
  path: string | null
  /** A line instead of a path: the last search of a Wanted Slot, the release of a download. */
  note: string | null
  size: string | null
  action: 'file' | 'search' | null
  /** The chip's tooltip: "4K: Wanted 7 d". */
  tip: string
}

/** One Slot of an episode, said in words. `grab` is the Grab covering it, if any. */
export function slotDetail(e: Episode, key: string, name: string, grab: QueueItem | undefined, now = Date.now()): SlotDetail {
  const cell = cellOf(e, key)
  const base = { key, name, state: cell ? cell.state : null, path: null, note: null, size: null, action: null }
  if (!cell) return { ...base, text: 'No Version', tip: `${name}: no Version` }
  const state = cell.state as string
  const text = state === 'unmonitored' ? 'Not monitored' : (cellText(cell, e, grab, stateWord[state] ?? state, now) ?? state)
  const tip = `${name}: ${text.replace('Wanted · ', 'Wanted ')}`
  switch (state) {
    case 'filled':
      return { ...base, text, tip, path: cell.file?.path ?? null, size: cell.file ? size(cell.file.size) : null, action: cell.file ? 'file' : null }
    case 'wanted':
      return { ...base, text, tip, note: cell.last_search ? lastSearchLine(cell.last_search, now).replace(/^Last searched/, 'last searched') : 'not searched yet', action: 'search' }
    case 'downloading':
      return { ...base, text, tip, note: grab?.release_name ?? null, size: grab && grab.bytes_total > 0 ? size(grab.bytes_total) : null }
    case 'unreleased':
      return { ...base, text: e.air_date ? `Airs ${monthDay(e.air_date)}` : 'Not aired', tip: `${name}: not aired` }
    default:
      return { ...base, text, tip }
  }
}
