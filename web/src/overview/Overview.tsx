// Overview, the home screen: Needs attention, the health strip, Searching, Downloading now,
// Coming this week, Recently added and Recent requests.
import { Note } from '@hyprsh/design'
import { useState } from 'react'
import { useAttention } from '../api/attention'
import { useQueue, useCancelGrab } from '../api/queue'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { DownloadRow } from '../grabs/DownloadRow'
import { useListNav } from '../keys'
import { Coming, RecentlyAdded } from './ComingRecent'
import { HealthStrip } from './HealthStrip'
import { NeedsAttention, shownRows } from './NeedsAttention'
import { RecentRequests } from './RecentRequests'
import { Searching } from './Searching'
import { EmptyLine, firstFive, Section, ViewAll } from './Section'
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

  // One selection runs through every section in the order the screen reads: Needs attention, then
  // the main column (Downloading now, Recently added), then the side column (Coming this week, Recent
  // requests). Enter does what clicking the row would.
  const [sel, setSel] = useState(0)
  const enter: (() => void)[] = [
    ...rows.map((r) => () => {
      const open = r.actions.find((a) => a.method === 'GET')
      if (open) onOpen(open.path)
    }),
    ...items.map((i) => () => i.title_id != null && onOpenTitle(i.title_id)),
    ...recentItems.map((r) => () => onOpenTitle(r.title_id)),
    ...coming.map((c) => () => onOpenTitle(c.title_id)),
    ...requests.map((r) => () => r.title_id != null && onOpenTitle(r.title_id)),
  ]
  const nav = (base: number): OverviewNav => ({ base, sel, select: setSel })
  useListNav('ov', enter.length, sel, setSel, (i) => enter[i]?.())
  return (
    <div className="flex-1 overflow-y-auto p-6 max-sm:p-4">
      {/* One column below 1024px, in reading order; from 1024px Needs attention spans the top and the main column (two thirds) sits beside the side column. */}
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-8 lg:max-w-7xl lg:grid-cols-3">
        <div className="lg:col-span-3">
          <NeedsAttention onOpen={onOpen} onOpenTitle={onOpenTitle} nav={nav(0)} all={allAttention} onAll={setAllAttention} />
        </div>
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          <Section id="downloading-now" title="Downloading now" count={queue.data ? all.length : undefined}>
            {cancel.isError && <Note variant="error">{cancel.error.message}</Note>}
            {queue.data && items.length === 0 ? (
              <EmptyLine title="Nothing is downloading." />
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
          <Searching />
          <RecentlyAdded onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length)} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <HealthStrip />
          <Coming onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length + recentItems.length)} />
          <RecentRequests onOpenTitle={onOpenTitle} nav={nav(rows.length + items.length + recentItems.length + coming.length)} />
        </div>
      </div>
    </div>
  )
}
