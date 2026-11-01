// Overview, the home screen: its title, then "Happening now" (Needs attention rows and Downloads in one
// card), then Recently added, Recent requests and Coming this week in a grid, in a column of at most 1024px.
import { useState } from 'react'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { useListNav } from '../keys'
import { SidePanel } from '../layout/SidePanel'
import { usePhone } from '../responsive'
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
  const phone = usePhone()
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
    <>
      {/* A phone's header is the panel's: the title with what runs and Health. A desktop has the title in the content. */}
      {phone && <SidePanel title="Overview" />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Left aligned beside the rail like every screen's content, 24/32 padding, and no wider than the Title page's cards. */}
        <div className="max-w-5xl p-4 sm:px-8 sm:py-6">
          {!phone && <h1 className="heading-20 mb-6">Overview</h1>}
          {/* Happening now on top; the three cards below drop from three columns to two to one as the column narrows. */}
          <div className="@container flex flex-col gap-8">
            <HappeningNow model={happening} onOpen={onOpen} onOpenTitle={onOpenTitle} onOpenAdoption={onOpenAdoption} nav={nav(0)} />
            <div className="grid grid-cols-1 gap-8 @2xl:grid-cols-2 @4xl:grid-cols-3">
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
      </div>
    </>
  )
}
