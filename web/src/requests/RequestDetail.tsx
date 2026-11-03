// One Request opened by its address ("/requests/12"): the Title, who asked through what and when, the seasons asked
// for and where each Slot stands. A Request that is gone says so.
import { Button, Note } from '@hyprsh/design'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '../api/queries'
import { useQueue } from '../api/queue'
import { useRequest } from '../api/requests'
import { useSlotNames } from '../library/slots'
import { ago, useNow } from '../time'
import { reasons, seasonsText } from './status'
import { RequestSlots, requestStatus } from './RequestSlots'
import { sourceName } from './source'

const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export function RequestDetail({ id, onOpenTitle, onClose }: { id: number; onOpenTitle: (id: number) => void; onClose: () => void }) {
  const request = useRequest(id)
  const now = useNow()
  const queue = useQueue().data ?? []
  const slots = useSlotNames()
  const r = request.data
  if (request.isPending) return <p className="label-14 px-4 py-3 text-gray-900">Loading the Request…</p>
  if (!r) {
    const gone = request.error instanceof ApiError && request.error.status === 404
    return (
      <div className="p-4">
        <Note variant={gone ? 'warning' : 'error'}>{gone ? 'That Request no longer exists.' : 'The Request could not be loaded.'}</Note>
      </div>
    )
  }
  const reason = r.outcome === 'rejected' && r.reject_reason ? reasons[r.reject_reason] : null
  const facts: [string, ReactNode][] = [
    ['Requested by', r.requester.name],
    ['Source', sourceName(r.source)],
    ['Requested', `${full.format(new Date(r.created_at))} (${ago(r.created_at, now)})`],
    ...(r.seasons.length > 0 ? [['Seasons', seasonsText(r.seasons)] as [string, ReactNode]] : []),
    ['Status', reason ? `Rejected: ${reason.text}` : requestStatus(r, queue, slots)],
  ]
  return (
    <section aria-label="Request" className="px-4 pt-4 pb-2">
      <div className="flex items-start gap-2">
        <h2 className="heading-16 min-w-0 flex-1 truncate">{r.title ?? 'Unknown title'}</h2>
        {r.title_id != null && (
          <Button variant="secondary" size="small" onClick={() => onOpenTitle(r.title_id!)}>
            Open Title
          </Button>
        )}
        <Button variant="tertiary" size="small" aria-label="Close Request" prefix={<X />} onClick={onClose} />
      </div>
      <dl className="label-14 mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-900">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <dt className="text-gray-900">Slots</dt>
        <dd>
          <RequestSlots request={r} align="start" />
        </dd>
      </dl>
    </section>
  )
}
