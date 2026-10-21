// Overview, the home screen: Needs attention, the health strip, Downloading now,
// Coming this week and Recently added.
import { useState } from 'react'
import { useAttention } from '../api/attention'
import { useQueue, useCancelGrab } from '../api/queue'
import { useRecent, useUpcoming } from '../api/upcoming'
import { ErrorText } from '../forms'
import { DownloadRow } from '../grabs/DownloadRow'
import { useListNav } from '../keys'
import { ComingRecent } from './ComingRecent'
import { HealthStrip } from './HealthStrip'
import { NeedsAttention } from './NeedsAttention'
import type { OverviewNav } from './nav'

/** onOpen is how an action that opens a place in the app (a GET action) gets there. */
export function Overview({ onOpen = () => {}, onOpenTitle = () => {} }: { onOpen?: (path: string) => void; onOpenTitle?: (id: number) => void }) {
  const queue = useQueue()
  const cancel = useCancelGrab()
  const items = queue.data ?? []
  const rows = useAttention().data?.rows ?? []
  const coming = useUpcoming(6).data ?? []
  const recentItems = useRecent().data ?? []

  // One selection runs through every section; Enter does what clicking the row would.
  const [sel, setSel] = useState(0)
  const enter: (() => void)[] = [
    ...rows.map((r) => () => {
      const open = r.actions.find((a) => a.method === 'GET')
      if (open) onOpen(open.path)
    }),
    ...items.map((i) => () => i.title_id != null && onOpenTitle(i.title_id)),
    ...coming.map((c) => () => onOpenTitle(c.title_id)),
    ...recentItems.map((r) => () => onOpenTitle(r.title_id)),
  ]
  const nav = (base: number): OverviewNav => ({ base, sel, select: setSel })
  useListNav('ov', enter.length, sel, setSel, (i) => enter[i]?.())
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <NeedsAttention onOpen={onOpen} onOpenTitle={onOpenTitle} nav={nav(0)} />
      <HealthStrip />
      <section aria-labelledby="downloading-now" className="mx-auto max-w-3xl">
        <h2 id="downloading-now" className="mb-3 text-sm font-medium">
          Downloading now
        </h2>
        {cancel.isError && <ErrorText>{cancel.error.message}</ErrorText>}
        {queue.data && items.length === 0 ? (
          <p className="text-gray-900">Nothing is downloading.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {items.map((i, n) => (
              <DownloadRow
                key={i.grab_id}
                item={i}
                nav={{ scope: 'ov', index: rows.length + n, sel, onSelect: () => setSel(rows.length + n) }}
                busy={cancel.isPending}
                onCancel={(blocklist) => cancel.mutate({ id: i.grab_id, blocklist })}
                onOpenTitle={onOpenTitle}
              />
            ))}
          </ul>
        )}
      </section>
      <ComingRecent onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length)} />
    </div>
  )
}
