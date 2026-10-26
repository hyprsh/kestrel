// How a Request and its Slots read in words: shared by the admin's Requests rows and the Requester's own list.
import type { BadgeProps } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import type { Request } from '../api/requests'
import { percent } from '../format'

type Slot = Request['slots'][number]

/** Why Kestrel turned a Request down, in words, and the place that fixes it when there is one. */
export const reasons: Record<NonNullable<Request['reject_reason']>, { text: string; fix?: { label: string; path: string } }> = {
  not_on_tvdb: { text: 'TheTVDB does not list this Series' },
  unknown_title: { text: 'TMDB does not know this Title' },
  no_enabled_profile: { text: 'No Profile is enabled for the Slot', fix: { label: 'Enable a Profile', path: '/settings/profiles' } },
}

/**
 * Where a Slot stands. The Request's own `download` is as of its last fetch; the live queue
 * (`queue` frames) moves the percentage on in between and shows a Grab that started since.
 */
export function slotState(s: Slot, queue: QueueItem[]): { text: string; tone: NonNullable<BadgeProps['variant']> } {
  const live = s.status === 'queued' || s.status === 'downloading' ? queue.find((q) => s.version_id != null && q.version_id === s.version_id) : undefined
  const d = live ?? (s.status === 'downloading' ? s.download : null)
  if (d) {
    const pct = percent(d.bytes_total, d.bytes_left)
    return { text: pct == null ? 'Downloading' : `Downloading ${pct}%`, tone: 'blue' }
  }
  switch (s.status) {
    case 'completed':
      return { text: 'Completed', tone: 'green' }
    case 'failed':
      return { text: s.status_label, tone: 'gray' }
    default:
      return { text: s.status_label, tone: s.status_label === 'Searching' ? 'amber' : 'gray' }
  }
}

export const seasonsText = (seasons: number[]) => (seasons.length === 1 ? `Season ${seasons[0]}` : `Seasons ${seasons.join(', ')}`)
