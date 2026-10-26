import { Badge, EmptyState, Entity, LoadMoreButton, Note } from '@hyprsh/design'
import type { useMyRequests } from '../api/plex'
import type { Request } from '../api/requests'
import { RowList, stackedRight, stackedRow } from '../layout/RowList'
import { LoadingLine } from '../loading'
import { Poster, TitlePoster } from '../poster'
import { reasons, seasonsText, slotState } from '../requests/status'
import { slotLabel, type SlotKey } from '../library/bits'
import { ago, useNow } from '../time'

/** Why a Request was turned down. The Profile reason is the admin's to fix, so a Requester is sent to them. */
function rejection(r: Request): string {
  if (r.reject_reason === 'no_enabled_profile') return 'Kestrel cannot download this Title yet. Ask whoever runs Kestrel.'
  return r.reject_reason ? reasons[r.reject_reason].text : 'Kestrel could not add this Title'
}

/** "Your Requests": the Requester's own Requests, newest first, with where each Slot stands. */
export function MyRequests({ list, requests }: { list: ReturnType<typeof useMyRequests>; requests: Request[] }) {
  return (
    <section aria-labelledby="my-requests-title" className="flex flex-col gap-3">
      <h2 id="my-requests-title" className="heading-20">
        Your Requests
      </h2>
      {list.isPending && <LoadingLine>Loading your Requests…</LoadingLine>}
      {list.isError && (
        <Note variant="error" size="small">
          Your Requests could not be loaded.
        </Note>
      )}
      {list.data && requests.length === 0 && <EmptyState size="small" description="You have not asked for anything yet. Search above to find a Movie or Series." />}
      {requests.length > 0 && (
        <RowList aria-labelledby="my-requests-title">
          {requests.map((r) => (
            <MyRequest key={r.id} request={r} />
          ))}
        </RowList>
      )}
      {list.hasNextPage && (
        <LoadMoreButton variant="secondary" size="small" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Show older Requests
        </LoadMoreButton>
      )}
    </section>
  )
}

function MyRequest({ request: r }: { request: Request }) {
  const now = useNow()
  return (
    <Entity
      className={stackedRow}
      rightClassName={stackedRight}
      left={r.title_id != null ? <TitlePoster id={r.title_id} hasPoster={r.has_poster} size="md" /> : <Poster src={null} size="md" />}
      right={
        r.outcome === 'rejected' ? (
          <>
            <Badge variant="red" contrast="low" size="sm">
              Rejected
            </Badge>
            <span className="label-12">{rejection(r)}</span>
          </>
        ) : (
          r.slots.map((s) => {
            const st = slotState(s, [])
            return (
              <Badge key={s.slot} variant={st.tone} contrast="low" size="sm">
                {r.slots.length > 1 ? `${slotLabel[s.slot as SlotKey]} · ${st.text}` : st.text}
              </Badge>
            )
          })
        )
      }
    >
      <Entity.Content
        fill
        title={
          <>
            {r.title ?? 'Unknown title'}
            {r.seasons.length > 0 && <span className="font-normal text-gray-900"> · {seasonsText(r.seasons)}</span>}
          </>
        }
        description={`Asked ${ago(r.created_at, now)}`}
      />
    </Entity>
  )
}
