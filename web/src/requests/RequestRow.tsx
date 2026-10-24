// chrome: pending
// One Request as the Overview's Recent requests and the Requests screen draw it: the Title,
// who asked through what and when, the seasons asked for, and where each Slot stands.
import { Badge, Button, type BadgeProps } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import { useQueue } from '../api/queue'
import type { Request } from '../api/requests'
import { percent } from '../format'
import type { RowNav } from '../keys'
import { slotLabel, type SlotKey } from '../library/bits'
import { useOpenPlace } from '../place'
import { Poster, TitlePoster } from '../poster'
import { ago, useNow } from '../time'
import { NavRow } from '../ui'
import { sourceName } from './source'

type Slot = Request['slots'][number]

/** Why Kestrel turned a Request down, in words, and the place that fixes it when there is one. */
const reasons: Record<NonNullable<Request['reject_reason']>, { text: string; fix?: { label: string; path: string } }> = {
  not_on_tvdb: { text: 'TheTVDB does not list this Series' },
  unknown_title: { text: 'TMDB does not know this Title' },
  no_enabled_profile: { text: 'No Profile is enabled for the Slot', fix: { label: 'Enable a Profile', path: '/settings/profiles' } },
}

/**
 * Where a Slot stands. The Request's own `download` is as of its last fetch; the live queue
 * (`queue` frames) moves the percentage on in between and shows a Grab that started since.
 */
function slotState(s: Slot, queue: QueueItem[]): { text: string; tone: NonNullable<BadgeProps['variant']> } {
  const live = s.status === 'queued' || s.status === 'downloading' ? queue.find((q) => s.version_id != null && q.version_id === s.version_id) : undefined
  const d = live ?? (s.status === 'downloading' ? s.download : null)
  if (d) {
    const pct = percent(d.bytes_total, d.bytes_left)
    return { text: pct == null ? 'Downloading' : `Downloading ${pct}%`, tone: 'blue-subtle' }
  }
  switch (s.status) {
    case 'completed':
      return { text: 'Completed', tone: 'green-subtle' }
    case 'failed':
      return { text: s.status_label, tone: 'gray-subtle' }
    default:
      return { text: s.status_label, tone: s.status_label === 'Searching' ? 'amber-subtle' : 'gray-subtle' }
  }
}

const seasonsText = (seasons: number[]) => (seasons.length === 1 ? `Season ${seasons[0]}` : `Seasons ${seasons.join(', ')}`)

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
    <NavRow scope={nav.scope} index={nav.index} sel={nav.sel} onSelect={select} className="flex items-center gap-3 px-4 py-2">
      {r.title_id != null ? (
        <TitlePoster id={r.title_id} hasPoster={r.has_poster} className="h-12 w-8 rounded-sm" />
      ) : (
        <Poster src={null} className="h-12 w-8 rounded-sm" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="font-medium">{r.title ?? 'Unknown title'}</span>
          {r.seasons.length > 0 && <span className="text-gray-900"> · {seasonsText(r.seasons)}</span>}
        </span>
        <span className="label-12 block truncate text-gray-900">
          {r.requester.name} via {sourceName(r.source)} · {ago(r.created_at, now)}
        </span>
      </span>
      {reason ? (
        <span className="flex label-12 shrink-0 items-center gap-2 text-gray-900">
          <Badge variant="red-subtle" size="sm">Rejected</Badge>
          <span>{reason.text}</span>
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
        </span>
      ) : (
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {r.slots.map((s) => {
            const st = slotState(s, queue)
            return (
              <Badge key={s.slot} variant={st.tone} size="sm">
                {`${slotLabel[s.slot as SlotKey]} · ${st.text}`}
              </Badge>
            )
          })}
        </span>
      )}
    </NavRow>
  )
}
