// Overview, the home screen: "Happening now" (Needs attention rows and Downloads in one
// card) across the width, then Recently added, Recent requests and Coming this week side by side.
import { useState } from 'react'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { useListNav } from '../keys'
import { Coming, RecentlyAdded } from './ComingRecent'
import { HappeningNow, useHappeningNow } from './HappeningNow'
import { RecentRequests } from './RecentRequests'
import { firstFive } from './Section'
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
  const happening = useHappeningNow(onOpen, onOpenTitle, onOpenAdoption)
  const recentItems = firstFive(useRecent().data?.items ?? [])
  const requests = firstFive(useRecentRequests().data?.items ?? [])
  const coming = firstFive(useUpcoming(6).data ?? [])

  // One selection runs through every row in the order the screen reads: Happening now (its Needs attention
  // rows, then its groups, then its Downloads), then the second row left to right: Recently added, Recent requests, Coming this
  // week. Enter does what clicking would.
  const [sel, setSel] = useState(0)
  const enter: (() => void)[] = [
    ...happening.enter,
    ...recentItems.map((r) => () => onOpenTitle(r.title_id)),
    ...requests.map((r) => () => r.title_id != null && onOpenTitle(r.title_id)),
    ...coming.map((c) => () => onOpenTitle(c.title_id)),
  ]
  const nav = (base: number): OverviewNav => ({ base, sel, select: setSel })
  useListNav('ov', enter.length, sel, setSel, (i) => enter[i]?.())
  const happeningEnd = happening.enter.length
  const recentEnd = happeningEnd + recentItems.length
  const requestsEnd = recentEnd + requests.length
  return (
    <div className="flex-1 overflow-y-auto p-6 max-sm:p-4">
      {/* One column below 1024px, in reading order; from 1024px Happening now spans the width and the second row is three equal columns. */}
      <div className="mx-auto max-w-3xl lg:max-w-7xl">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-3">
            <HappeningNow model={happening} onOpen={onOpen} onOpenTitle={onOpenTitle} onOpenAdoption={onOpenAdoption} nav={nav(0)} />
          </div>
          <div className="min-w-0">
            <RecentlyAdded onOpenTitle={onOpenTitle} nav={nav(happeningEnd)} />
          </div>
          <div className="min-w-0">
            <RecentRequests onOpenTitle={onOpenTitle} nav={nav(recentEnd)} />
          </div>
          <div className="min-w-0">
            <Coming onOpenTitle={onOpenTitle} nav={nav(requestsEnd)} />
          </div>
        </div>
      </div>
    </div>
  )
}
