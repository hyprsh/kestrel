// One Request as the Overview's Recent requests and the Requests screen draw it: the Title,
// who asked through what and when, the seasons asked for, and where each Slot stands.
import { Badge, Button, Entity } from '@hyprsh/design'
import { stackedRow, stackedRight } from '../layout/RowList'
import { useQueue } from '../api/queue'
import type { Request } from '../api/requests'
import type { RowNav } from '../keys'
import { slotLabel, type SlotKey } from '../library/bits'
import { useOpenPlace } from '../place'
import { ago, useNow } from '../time'
import { Poster, TitlePoster } from '../poster'
import { sourceName } from './source'
import { reasons, seasonsText, slotState } from './status'

/** A Request's row; clicking it, or Enter on it, opens the Title when there is one. */
export function RequestRow({ request: r, nav, onOpenTitle }: { request: Request; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const queue = useQueue().data ?? []
  const now = useNow()
  const openPlace = useOpenPlace()
  const reason = r.outcome === 'rejected' && r.reject_reason ? reasons[r.reject_reason] : null
  const select = () => {
    nav.onSelect()
    if (r.title_id != null) onOpenTitle(r.title_id)
  }
  return (
    <Entity
      as="button"
      current={nav.index === nav.sel}
      data-nav={`${nav.scope}-${nav.index}`}
      onClick={select}
      className={stackedRow}
      rightClassName={stackedRight}
      left={r.title_id != null ? <TitlePoster id={r.title_id} hasPoster={r.has_poster} size="sm" /> : <Poster src={null} size="sm" />}
      right={
        reason ? (
          <>
            <Badge variant="red" contrast="low" size="sm">
              Rejected
            </Badge>
            <span className="label-12">{reason.text}</span>
            {reason.fix && (
              <Button
                variant="tertiary"
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  openPlace(reason.fix!.path)
                }}
              >
                {reason.fix.label}
              </Button>
            )}
          </>
        ) : (
          r.slots.map((s) => {
            const st = slotState(s, queue)
            return (
              <Badge key={s.slot} variant={st.tone} contrast="low" size="sm">
                {`${slotLabel[s.slot as SlotKey]} · ${st.text}`}
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
        description={`${r.requester.name} via ${sourceName(r.source)} · ${ago(r.created_at, now)}`}
      />
    </Entity>
  )
}
