// Overview, the home screen: its title with the range selector, the headline figures, "Happening now" (Needs attention rows, then
// the Downloading and Searching cards side by side), the dashboard (Grabs per day, Indexers, the download client, Library quality, Storage,
// release groups and Requests, all for the chosen range), then Recently added, Recent requests and Coming this week, in a
// column of at most 1120px. A phone shows the figures, Happening now, the Grabs chart, Indexers and the client on one line.
import { Select, Skeleton } from '@hyprsh/design'
import { useState } from 'react'
import { useStats, type StatsRange } from '../api/stats'
import { useRecentRequests } from '../api/requests'
import { useRecent, useUpcoming } from '../api/upcoming'
import { useListNav } from '../keys'
import { SidePanel } from '../layout/SidePanel'
import { useUrlParam } from '../place'
import { usePhone } from '../responsive'
import { ClientCard } from './ClientCard'
import { ClientLine } from './ClientLine'
import { Coming, RecentlyAdded } from './ComingRecent'
import { GrabsCard, IndexersCard } from './GrabsAndIndexers'
import { HappeningNow, useHappeningNow } from './HappeningNow'
import { QualityCard, StorageCard } from './LibraryCards'
import { GroupsCard, RequestsCard } from './PeopleCards'
import { RecentRequests } from './RecentRequests'
import { firstThree } from './Section'
import { ranges } from './statsText'
import { Tiles } from './Tiles'
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
  // The range lives in the address ("?range=7d"), so Back from a drill-down and a reload keep it; Last 30 days leaves the address clean.
  const [rangeParam, setRangeParam] = useUrlParam('range')
  const range: StatsRange = ranges.find((r) => r.value === rangeParam)?.value ?? '30d'
  const setRange = (r: StatsRange) => setRangeParam(r === '30d' ? null : r)
  const stats = useStats(range)
  const happening = useHappeningNow(onOpen, onOpenTitle, onOpenAdoption)
  const recentItems = firstThree(useRecent().data?.items ?? [])
  const requests = firstThree(useRecentRequests().data?.items ?? [])
  const coming = firstThree(useUpcoming(6).data ?? [])

  // One selection runs through every row in the order the screen reads: Happening now (its Needs attention
  // rows, then its groups, then the Downloading card, then the Searching card), then the second row left to right: Recently added, Recent requests, Coming this
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
      {/* Relative, so the cards' hidden tables for screen readers (sr-only, absolutely placed) stay in this scroll area instead of lengthening the page. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Left aligned beside the rail like every screen's content, 24/32 padding, and no wider than the dashboard needs. */}
        <div className="max-w-[1120px] p-4 sm:px-8 sm:py-6">
          <div className="mb-6 flex items-center gap-3 max-sm:mb-4 max-sm:justify-end">
            {!phone && <h1 className="heading-20 flex-1">Overview</h1>}
            <Select size="small" aria-label="Range" value={range} onChange={(e) => setRange(e.target.value as StatsRange)} options={ranges.map((r) => ({ value: r.value, label: r.label }))} />
          </div>
          {/* The figures, Happening now, the dashboard and the three cards below it; the cards drop from three columns to two to one as the column narrows. */}
          <div className="@container flex flex-col gap-8 max-sm:gap-4">
            {stats.data ? (
              <div className={stats.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={stats.isPlaceholderData}>
                <Tiles stats={stats.data} phone={phone} />
              </div>
            ) : (
              !stats.isError && <Skeleton height={phone ? 140 : 84} />
            )}
            <HappeningNow model={happening} onOpen={onOpen} onOpenTitle={onOpenTitle} onOpenAdoption={onOpenAdoption} nav={nav(0)} />
            {stats.data && (
              <div className={`flex flex-col gap-4 transition-opacity ${stats.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={stats.isPlaceholderData}>
                <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
                  <GrabsCard stats={stats.data} />
                  <IndexersCard stats={stats.data} phone={phone} />
                </div>
                {phone ? (
                  <ClientLine stats={stats.data} />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
                      <ClientCard stats={stats.data} />
                      <QualityCard stats={stats.data} />
                      <StorageCard stats={stats.data} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
                      <GroupsCard stats={stats.data} />
                      <RequestsCard stats={stats.data} />
                    </div>
                  </>
                )}
              </div>
            )}
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
