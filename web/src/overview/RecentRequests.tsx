// "Recent requests": the newest five Requests from outside Kestrel, with no time cutoff, as compact
// rows (poster, Title, who asked and where it stands) and a way to the Requests screen for the rest.
// Its rows are part of the Overview's j/k selection.
import { Badge, Entity } from '@hyprsh/design'
import { RowList } from '../layout/RowList'
import { useRecentRequests, type Request } from '../api/requests'
import { Loaded, SkeletonRows } from '../loading'
import { Poster, TitlePoster } from '../poster'
import { RequestSlots } from '../requests/RequestSlots'
import { reasons } from '../requests/status'
import type { OverviewNav } from './nav'
import { EmptyLine, firstThree, HeadingLink, Section } from './Section'

function StateBadges({ request: r }: { request: Request }) {
  if (r.outcome === 'rejected' && r.reject_reason) {
    return (
      <Badge variant="red" contrast="low" size="sm">
        {`Rejected · ${reasons[r.reject_reason].text}`}
      </Badge>
    )
  }
  return <RequestSlots request={r} />
}

export function RecentRequests({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecentRequests()
  const shown = firstThree(recent.data?.items ?? [])
  const total = recent.data?.total ?? 0
  return (
    <Section id="recent-requests" title="Recent requests" count={recent.data ? total : undefined} action={total > 0 ? <HeadingLink path="/requests" label="Requests" /> : undefined}>
      <Loaded query={recent} skeleton={<SkeletonRows poster="sm" />} empty={<EmptyLine title="Nobody has asked for anything yet." />} isEmpty={() => shown.length === 0}>
        {() => (
          <RowList>
            {shown.map((r, j) => {
              const i = nav.base + j
              return (
                <Entity
                  key={r.id}
                  as="button"
                  current={i === nav.sel}
                  data-nav={`ov-${i}`}
                  onClick={() => {
                    nav.select(i)
                    if (r.title_id != null) onOpenTitle(r.title_id)
                  }}
                  left={r.title_id != null ? <TitlePoster id={r.title_id} hasPoster={r.has_poster} size="sm" /> : <Poster src={null} size="sm" />}
                >
                  <Entity.Content
                    fill
                    title={<span className="font-medium">{r.title ?? 'Unknown title'}</span>}
                    description={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{r.requester.name}</span>
                        <StateBadges request={r} />
                      </span>
                    }
                  />
                </Entity>
              )
            })}
          </RowList>
        )}
      </Loaded>
    </Section>
  )
}
