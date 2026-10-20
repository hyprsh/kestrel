// The Originals available group of Needs attention: one row per Version whose Profile offers a
// Release with the Title's Original Language only, with Accept and Dismiss and a link to the Title.
import { useState } from 'react'
import { offerUnits, useAcceptOffer, useDismissOffer, type OriginalOffer, type OriginalsAvailable } from '../api/offers'
import { Button, ErrorText } from '../forms'
import { slotLabel } from '../library/bits'
import { Badge } from '../ui'

/**
 * Like Long Missing, one grouped row after the others and outside the rail
 * badge. It expands to one row per Version, best Release first.
 */
export function OriginalsRow({ group, onOpenTitle }: { group: OriginalsAvailable; onOpenTitle: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-originals className="mt-3 rounded-lg border border-gray-alpha-400 px-4 py-3">
      <div className="flex items-center gap-2">
        <Badge tone="amber">Originals</Badge>
        <span className="min-w-0 flex-1">
          Originals available · {group.count}
        </span>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-gray-alpha-400">
          {group.items.map((o) => (
            <Offer key={o.version_id} offer={o} onOpenTitle={onOpenTitle} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Offer({ offer: o, onOpenTitle }: { offer: OriginalOffer; onOpenTitle: (id: number) => void }) {
  const accept = useAcceptOffer()
  const dismiss = useDismissOffer()
  const units = offerUnits(o)
  const busy = accept.isPending || dismiss.isPending
  const failed = accept.error ?? dismiss.error
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <button type="button" title="Open the Title" onClick={() => onOpenTitle(o.title_id)} className="font-medium hover:underline">
            {o.title}
          </button>{' '}
          · {slotLabel[o.slot]} · {o.profile}
        </span>
        <Button variant="secondary" disabled={busy} onClick={() => accept.mutate(o.version_id)}>
          Accept
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => dismiss.mutate(o.version_id)}>
          Dismiss
        </Button>
      </div>
      <div className="truncate font-mono text-[11px] text-gray-900" title={o.release}>
        {o.release} · Score {o.score}
      </div>
      {units && <div className="text-[12px] text-gray-900">{units}</div>}
      {failed && <ErrorText>{failed.message}</ErrorText>}
    </li>
  )
}
