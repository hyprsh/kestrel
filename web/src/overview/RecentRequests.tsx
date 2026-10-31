// "Recent requests": the newest five Requests from outside Kestrel, with no time cutoff, and a
// way to the Requests screen for the rest. Its rows are part of the Overview's j/k selection.
import { RowList } from '../layout/RowList'
import { useRecentRequests } from '../api/requests'
import { Loaded, SkeletonRows } from '../loading'
import { RequestRow } from '../requests/RequestRow'
import type { OverviewNav } from './nav'
import { EmptyLine, firstFive, Section, ViewAll } from './Section'

export function RecentRequests({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecentRequests()
  const shown = firstFive(recent.data?.items ?? [])
  const total = recent.data?.total ?? 0
  return (
    <Section id="recent-requests" title="Recent requests" count={recent.data ? total : undefined}>
      <Loaded query={recent} skeleton={<SkeletonRows poster="md" />} empty={<EmptyLine title="Nobody has asked for anything yet." />} isEmpty={() => shown.length === 0}>
        {() => (
          <RowList>
            {shown.map((r, j) => {
              const i = nav.base + j
              return <RequestRow key={r.id} request={r} nav={{ scope: 'ov', index: i, sel: nav.sel, onSelect: () => nav.select(i) }} onOpenTitle={onOpenTitle} posterSize="md" />
            })}
          </RowList>
        )}
      </Loaded>
      {total > 0 && <ViewAll path="/requests" count={total} />}
    </Section>
  )
}
