// The status chips under the Overview's header: Health (on a phone only; a desktop has it in the top bar), Searching, Indexers and, only while a Root
// folder's disk is low, Disk. Each is one line that links to its detail in Activity. The Health
// section's tiles and the Searching card live in Activity's Health and Background Jobs tabs.
import { Pill, StatusDot, Skeleton } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useStatus, type SystemStatus } from '../api/attention'
import { useSearchStatus, type SearchStatus } from '../api/search'
import { plural } from '../format'
import { useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { HealthPill } from '../shell/HealthPill'
import { until, useNow } from '../time'

type Dot = 'success' | 'warning' | 'error' | 'neutral' | 'pending'

function Chip({ dot, path, children }: { dot?: Dot; path: string; children: ReactNode }) {
  const openPlace = useOpenPlace()
  return (
    <Pill icon={dot ? <StatusDot state={dot} label={false} aria-hidden="true" /> : undefined} onClick={() => openPlace(path)}>
      {children}
    </Pill>
  )
}

const ChipSkeleton = () => <Skeleton width={120} height={24} />

/** "Searching 3 of 12 Wanted · next pass in 14 min", or "Nothing waiting · next pass in …". */
function searchLine(s: SearchStatus, now: number): string {
  const main = s.pass ? `Searching ${s.pass.done} of ${s.pass.total} Wanted` : s.due.versions > 0 ? `${s.due.versions} Wanted waiting` : 'Nothing waiting'
  return s.next_pass_at ? `${main} · next pass ${until(s.next_pass_at, now)}` : main
}

function SearchingChip() {
  const search = useSearchStatus()
  const now = useNow()
  if (!search.data) return search.isPending ? <ChipSkeleton /> : null
  return (
    <Chip dot={search.data.pass ? 'pending' : undefined} path="/activity/jobs">
      {searchLine(search.data, now)}
    </Chip>
  )
}

type Indexer = SystemStatus['indexers'][number]

/** "2 indexers · 110 searches left today": the enabled ones, and the budget left of those that report a limit. */
function indexersLine(indexers: Indexer[]): string | null {
  const enabled = indexers.filter((i) => i.state !== 'disabled')
  if (enabled.length === 0) return null
  const limited = enabled.filter((i) => i.search_max != null)
  const left = limited.reduce((n, i) => n + Math.max(0, i.search_max! - i.search_used), 0)
  const count = plural(enabled.length, 'indexer')
  return limited.length > 0 ? `${count} · ${left} searches left today` : count
}

/** The disks under their own low-space threshold, which is the one the Health tab and Needs attention use. */
const lowDisks = (s: SystemStatus) => s.disks.filter((d) => d.free_bytes < d.low_free_bytes)

export function StatusChips() {
  const status = useStatus()
  const s = status.data
  // The desktop top bar carries the Health pill; a phone's has no room for it.
  const phone = usePhone()
  const indexers = s ? indexersLine(s.indexers) : null
  return (
    <div role="group" aria-label="Status" className="mb-6 flex flex-wrap items-center gap-2">
      {phone && <HealthPill />}
      <SearchingChip />
      {!s && status.isPending && <ChipSkeleton />}
      {indexers && <Chip path="/activity/health">{indexers}</Chip>}
      {s &&
        lowDisks(s).map((d) => (
          <Chip key={d.path} dot="warning" path="/activity/health">
            {`${d.path} ${Math.round(((d.total_bytes - d.free_bytes) / d.total_bytes) * 100)}% full`}
          </Chip>
        ))}
    </div>
  )
}
