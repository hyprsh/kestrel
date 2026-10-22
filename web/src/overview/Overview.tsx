// Overview, the home screen: Needs attention, the health strip, Searching, Downloading now,
// Coming this week, Recently added and Recent requests.
import { EmptyState, Note } from '@hyprsh/design'
import { useState } from 'react'
import { useAttention } from '../api/attention'
import { useQueue, useCancelGrab } from '../api/queue'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { DownloadRow } from '../grabs/DownloadRow'
import { useListNav } from '../keys'
import { ComingRecent } from './ComingRecent'
import { HealthStrip } from './HealthStrip'
import { NeedsAttention, shownRows } from './NeedsAttention'
import { RecentRequests } from './RecentRequests'
import { Searching } from './Searching'
import { firstFive, Section, ViewAll } from './Section'
import type { OverviewNav } from './nav'

/** onOpen is how an action that opens a place in the app (a GET action) gets there. */
export function Overview({ onOpen = () => {}, onOpenTitle = () => {} }: { onOpen?: (path: string) => void; onOpenTitle?: (id: number) => void }) {
  const queue = useQueue()
  const cancel = useCancelGrab()
  const all = queue.data ?? []
  const items = firstFive(all)
  const [allAttention, setAllAttention] = useState(false)
  const rows = shownRows(useAttention().data?.rows ?? [], allAttention)
  const coming = firstFive(useUpcoming(6).data ?? [])
  const recentItems = firstFive(useRecent().data?.items ?? [])
  const requests = firstFive(useRecentRequests().data?.items ?? [])

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
    ...requests.map((r) => () => r.title_id != null && onOpenTitle(r.title_id)),
  ]
  const nav = (base: number): OverviewNav => ({ base, sel, select: setSel })
  useListNav('ov', enter.length, sel, setSel, (i) => enter[i]?.())
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <NeedsAttention onOpen={onOpen} onOpenTitle={onOpenTitle} nav={nav(0)} all={allAttention} onAll={setAllAttention} />
      <HealthStrip />
      <Searching />
      <Section id="downloading-now" title="Downloading now" count={queue.data ? all.length : undefined}>
        {cancel.isError && <Note variant="error">{cancel.error.message}</Note>}
        {queue.data && items.length === 0 ? (
          <EmptyState size="small" title="Nothing is downloading." />
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
        {all.length > 0 && <ViewAll path="/activity" count={all.length} />}
      </Section>
      <ComingRecent onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length)} />
      <RecentRequests onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length + coming.length + recentItems.length)} />
    </div>
  )
}
