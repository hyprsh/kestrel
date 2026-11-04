// "Recent requests": the newest three Requests from outside Kestrel, with no time cutoff, as compact
// rows (poster, Title, who asked and where it stands) and a link in the header to the Requests screen for the rest.
// Its rows are part of the Overview's j/k selection.
import { Badge } from '@hyprsh/design'
import { useRecentRequests, type Request } from '../api/requests'
import { NowCard, NowEmpty, NowLine, NowList, NowRow, NowSkeletonRows, NowTitle } from '../layout/NowCard'
import { Loaded } from '../loading'
import { useOpenPlace } from '../place'
import { Poster, TitlePoster } from '../poster'
import { RequestSlots, requestStatus } from '../requests/RequestSlots'
import { useQueue } from '../api/queue'
import { useSlotNames } from '../library/slots'
import { reasons } from '../requests/status'
import type { OverviewNav } from './nav'
import { firstThree } from './Section'

/** "Mia · Downloading 40%": who asked, then where the Request stands (a rejected one says why on its badge). */
function useRequestLine(r: Request): string {
  const queue = useQueue().data ?? []
  const slots = useSlotNames()
  if (r.outcome === 'rejected' && r.reject_reason) return r.requester.name
  return [r.requester.name, requestStatus(r, queue, slots)].filter(Boolean).join(' · ')
}

function RequestRow({ request: r, index, nav, onOpenTitle }: { request: Request; index: number; nav: OverviewNav; onOpenTitle: (id: number) => void }) {
  const line = useRequestLine(r)
  const rejected = r.outcome === 'rejected' && r.reject_reason
  return (
    <NowRow
      navIndex={index}
      current={index === nav.sel}
      onSelect={() => nav.select(index)}
      onOpen={() => r.title_id != null && onOpenTitle(r.title_id)}
      lead={r.title_id != null ? <TitlePoster id={r.title_id} hasPoster={r.has_poster} size="xs" /> : <Poster src={null} size="xs" />}
      right={
        rejected ? (
          <Badge variant="red" contrast="low" size="sm">
            {`Rejected · ${reasons[r.reject_reason!].text}`}
          </Badge>
        ) : (
          <RequestSlots request={r} />
        )
      }
    >
      <NowTitle name={r.title ?? 'Unknown title'} />
      <NowLine>{line}</NowLine>
    </NowRow>
  )
}

export function RecentRequests({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecentRequests()
  const openPlace = useOpenPlace()
  const shown = firstThree(recent.data?.items ?? [])
  const total = recent.data?.total ?? 0
  return (
    <NowCard
      title="Recent requests"
      label={total ? `Recent requests · ${total}` : undefined}
      meta={total || undefined}
      link={total > 0 ? { label: 'Requests', onOpen: () => openPlace('/requests') } : undefined}
    >
      <Loaded query={recent} skeleton={<NowSkeletonRows />} empty={<NowEmpty>Nobody has asked for anything yet.</NowEmpty>} isEmpty={() => shown.length === 0}>
        {() => (
          <NowList>
            {shown.map((r, j) => (
              <RequestRow key={r.id} request={r} index={nav.base + j} nav={nav} onOpenTitle={onOpenTitle} />
            ))}
          </NowList>
        )}
      </Loaded>
    </NowCard>
  )
}
