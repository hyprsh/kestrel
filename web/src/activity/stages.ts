// Activity's pipeline: which stage each Grab is in, from the queue, GET /grabs and the Blocklist.
import { HISTORY_DAYS, type GrabEntry } from '../api/activity'
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import type { components } from '../api/schema.gen'
import { phases } from '../grabs/phase'

type BlocklistEntry = components['schemas']['BlocklistEntry']

/** The stages in pipeline order; `stage:` takes these names. */
export const stages = ['searching', 'queued', 'downloading', 'processing', 'importing', 'stalled', 'done', 'failed'] as const
export type Stage = (typeof stages)[number]

export const stageLabel: Record<Stage, string> = {
  searching: 'Searching',
  queued: 'Queued',
  downloading: 'Downloading',
  processing: 'Post-processing',
  importing: 'Importing',
  stalled: 'Stalled',
  done: 'Done',
  failed: 'Failed',
}

/** A row of the list: an active Grab, a stalled or finished one, or a Release blocklisted without a Grab left. */
export type Entry =
  | { type: 'active'; key: string; stage: Stage; item: QueueItem }
  | { type: 'grab'; key: string; stage: Stage; grab: GrabEntry }
  | { type: 'blocked'; key: string; stage: Stage; entry: BlocklistEntry; title?: TitleRow }

/**
 * Every row in stage order: active Grabs as the queue lists them (oldest first), stalled
 * Imports, then Done and Failed newest first. Failed also holds the Blocklist entries of the
 * last HISTORY_DAYS no listed Grab accounts for, such as a Release canceled and blocklisted.
 */
export function entriesOf(
  queue: readonly QueueItem[],
  stalled: readonly GrabEntry[],
  finished: readonly GrabEntry[],
  blocked: readonly BlocklistEntry[],
  titles: readonly TitleRow[],
  now: number,
): Entry[] {
  const active: Entry[] = queue.map((item) => ({ type: 'active', key: `g${item.grab_id}`, stage: phases[item.phase].stage, item }))
  const held: Entry[] = stalled.map((grab) => ({ type: 'grab', key: `g${grab.grab_id}`, stage: 'stalled', grab }))
  const listed = new Set(finished.map((g) => g.grab_id))
  const since = now - HISTORY_DAYS * 86_400_000
  const ended: (Entry & { at: string })[] = [
    ...finished.map((grab) => ({ type: 'grab' as const, key: `g${grab.grab_id}`, stage: grab.state === 'imported' ? ('done' as const) : ('failed' as const), grab, at: grab.updated_at })),
    ...blocked
      .filter((b) => Date.parse(b.created_at) >= since && (b.grab_id === null || !listed.has(b.grab_id)))
      .map((entry) => ({
        type: 'blocked' as const,
        key: `b${entry.id}`,
        stage: 'failed' as const,
        entry,
        title: titles.find((t) => t.id === entry.title_id),
        at: entry.created_at,
      })),
  ]
  ended.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return [...active, ...held, ...ended]
}

/** What the filters look at: the Title's kind and the Slot, when known, and the words to match. */
export function facetsOf(e: Entry): { kind: string | null; slot: string | null; text: string[] } {
  switch (e.type) {
    case 'active':
      return { kind: e.item.kind, slot: e.item.slot, text: [e.item.title, e.item.release_name, e.item.indexer] }
    case 'grab':
      return { kind: e.grab.kind, slot: e.grab.slot, text: [e.grab.title, e.grab.release_name, e.grab.indexer] }
    case 'blocked':
      return { kind: e.title?.kind ?? null, slot: null, text: [e.title?.title ?? '', e.entry.release_name, e.entry.reason] }
  }
}
