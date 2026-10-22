// "Recent requests": the newest five Requests from outside Kestrel, with no time cutoff, and a
// way to the Requests screen for the rest. Its rows are part of the Overview's j/k selection.
import { EmptyState } from '@hyprsh/design'
import { useRecentRequests } from '../api/requests'
import { RequestRow } from '../requests/RequestRow'
import type { OverviewNav } from './nav'
import { firstFive, Section, ViewAll } from './Section'

export function RecentRequests({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecentRequests()
  const shown = firstFive(recent.data?.items ?? [])
  const total = recent.data?.total ?? 0
  return (
    <Section id="recent-requests" title="Recent requests" count={recent.data ? total : undefined} className="mt-6">
      {recent.data && shown.length === 0 ? (
        <EmptyState size="small" title="Nobody has asked for anything yet." />
      ) : (
        <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
          {shown.map((r, j) => {
            const i = nav.base + j
            return <RequestRow key={r.id} request={r} nav={{ scope: 'ov', index: i, sel: nav.sel, onSelect: () => nav.select(i) }} onOpenTitle={onOpenTitle} />
          })}
        </ul>
      )}
      {total > 0 && <ViewAll path="/requests" count={total} />}
    </Section>
  )
}
