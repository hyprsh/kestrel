// Overview, the home screen: the status chips, Needs attention, Downloading now beside Recent requests, and
// the Recently added and Coming this week poster shelves.
import { useState } from 'react'
import { useAttention } from '../api/attention'
import { useQueue } from '../api/queue'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { useCancel } from '../grabs/useCancel'
import { useListNav } from '../keys'
import { SkeletonRows } from '../loading'
import { Coming, RecentlyAdded, shelfShown } from './ComingRecent'
import { Downloads } from './Downloads'
import { NeedsAttention, shownRows } from './NeedsAttention'
import { RecentRequests } from './RecentRequests'
import { EmptyLine, firstFive, Section, ViewAll } from './Section'
import { useShelfCount } from './Shelf'
import { StatusChips } from './StatusChips'
import type { OverviewNav } from './nav'

export function Overview({
  onOpen = () => {},
  onOpenTitle = () => {},
  onOpenAdoption = () => {},
}: {
  onOpen?: (path: string) => void
  onOpenTitle?: (id: number) => void
  onOpenAdoption?: () => void
}) {
  const queue = useQueue()
  const cancel = useCancel()
  const all = queue.data ?? []
  const items = firstFive(all)
  const [allAttention, setAllAttention] = useState(false)
  const rows = shownRows(useAttention().data?.rows ?? [], allAttention)
  const recentShelf = useShelfCount()
  const comingShelf = useShelfCount()
  const recentItems = shelfShown(useRecent().data?.items ?? [], recentShelf.count)
  const coming = shelfShown(useUpcoming(6).data ?? [], comingShelf.count)
  const requests = firstFive(useRecentRequests().data?.items ?? [])

  // One selection runs through every row and poster in the order the screen reads: Needs attention,
  // Downloading now, Recent requests, then the Recently added and Coming this week shelves. The chips
  // are buttons of their own. Enter does what clicking would.
  const [sel, setSel] = useState(0)
  const enter: (() => void)[] = [
    ...rows.map((r) => () => {
      const open = r.actions.find((a) => a.method === 'GET')
      if (open) onOpen(open.path)
    }),
    ...items.map((i) => () => i.title_id != null && onOpenTitle(i.title_id)),
    ...requests.map((r) => () => r.title_id != null && onOpenTitle(r.title_id)),
    ...recentItems.map((r) => () => onOpenTitle(r.title_id)),
    ...coming.map((c) => () => onOpenTitle(c.title_id)),
  ]
  const nav = (base: number): OverviewNav => ({ base, sel, select: setSel })
  useListNav('ov', enter.length, sel, setSel, (i) => enter[i]?.())
  const downloadsEnd = rows.length + items.length
  const requestsEnd = downloadsEnd + requests.length
  return (
    <div className="flex-1 overflow-y-auto p-6 max-sm:p-4">
      {/* One column below 1024px, in reading order; from 1024px Downloading now (two thirds) sits beside Recent requests, and the shelves span the width. */}
      <div className="mx-auto max-w-3xl lg:max-w-7xl">
        <StatusChips />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-3">
            <NeedsAttention onOpen={onOpen} onOpenTitle={onOpenTitle} onOpenAdoption={onOpenAdoption} nav={nav(0)} all={allAttention} onAll={setAllAttention} />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Section id="downloading-now" title="Downloading now" count={queue.data ? all.length : undefined}>
              {queue.isPending ? (
                <SkeletonRows poster="sm" />
              ) : queue.data && items.length === 0 ? (
                <EmptyLine title="Nothing is downloading." />
              ) : (
                <Downloads
                  items={items}
                  firstIndex={rows.length}
                  sel={sel}
                  onSelect={setSel}
                  busy={cancel.pending}
                  onCancel={(id, blocklist) => void cancel.run(id, blocklist)}
                  onOpenTitle={onOpenTitle}
                />
              )}
              {all.length > 0 && <ViewAll path="/activity" label="All activity →" />}
            </Section>
          </div>
          <div className="min-w-0">
            <RecentRequests onOpenTitle={onOpenTitle} nav={nav(downloadsEnd)} />
          </div>
          <div className="min-w-0 lg:col-span-3">
            <RecentlyAdded onOpenTitle={onOpenTitle} nav={nav(requestsEnd)} shelf={recentShelf} />
          </div>
          <div className="min-w-0 lg:col-span-3">
            <Coming onOpenTitle={onOpenTitle} nav={nav(requestsEnd + recentItems.length)} shelf={comingShelf} />
          </div>
        </div>
      </div>
    </div>
  )
}
