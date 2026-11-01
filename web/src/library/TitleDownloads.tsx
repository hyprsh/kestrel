// A Title's active Grabs, grouped by Slot, for the Version cards and the header's badges. Kept live by the
// same `queue` frames as the Overview's Downloading now.
import { useCancelGrab, useQueue, type QueueItem } from '../api/queue'
import { percent } from '../format'
import { useReport } from '../toasts'

/** What the Grabs of one Slot add up to: the overall percent (null when the client knows no size) and the longest time left. */
export type SlotDownloads = { items: QueueItem[]; pct: number | null; eta: number | null }

const sum = (items: QueueItem[], f: (i: QueueItem) => number) => items.reduce((n, i) => n + f(i), 0)

export function downloadsOf(items: QueueItem[]): SlotDownloads {
  // An importing Grab is all downloaded.
  const total = sum(items, (i) => i.bytes_total)
  const left = sum(items, (i) => (i.phase === 'importing' ? 0 : i.bytes_left))
  const etas = items.map((i) => i.eta).filter((e): e is number => e != null)
  return { items, pct: percent(total, left), eta: etas.length > 0 ? Math.max(...etas) : null }
}

/** This Title's active Grabs: all of them, and by Slot. The queue is filtered by `title_id`. */
export function useTitleDownloads(titleId: number) {
  const items = (useQueue().data ?? []).filter((i) => i.title_id === titleId)
  const slot = (k: string) => {
    const mine = items.filter((i) => i.slot === k)
    return mine.length > 0 ? downloadsOf(mine) : null
  }
  return { all: items, slot }
}

/** Cancels Grabs, with or without the Blocklist, and says in one Toast what happened. */
export function useCancelDownloads() {
  const cancel = useCancelGrab()
  const report = useReport()
  return {
    pending: cancel.isPending,
    run: (items: QueueItem[], blocklist: boolean) =>
      report(Promise.all(items.map((i) => cancel.mutateAsync({ id: i.grab_id, blocklist }))), {
        done: blocklist
          ? items.length === 1
            ? 'Grab cancelled and its Release blocklisted'
            : 'Grabs cancelled and their Releases blocklisted'
          : items.length === 1
            ? 'Grab cancelled'
            : 'Grabs cancelled',
        failed: 'Could not cancel the Grab',
      }),
  }
}
