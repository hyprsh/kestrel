// The Originals available group of Needs attention: one row per Version whose Profile offers a
// Release with the Title's Original Language only, with Accept and Dismiss and a link to the Title.
import { Badge, Button, Note } from '@hyprsh/design'
import { useState } from 'react'
import { offerUnits, useAcceptOffer, useDismissOffer, type OriginalOffer, type OriginalsAvailable } from '../api/offers'
import { useProfiles } from '../api/queries'
import { slotLabel } from '../library/bits'

/**
 * Like Long Missing, one grouped row after the others and outside the rail
 * badge. It expands to one row per Version, best Release first.
 */
export function OriginalsRow({ group, onOpenTitle }: { group: OriginalsAvailable; onOpenTitle: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const profiles = useProfiles()
  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  return (
    <div data-originals className="mt-3 rounded-lg border border-gray-alpha-400 px-4 py-3">
      <div className="flex items-center gap-2">
        <Badge variant="amber-subtle" size="sm">Originals</Badge>
        <span className="min-w-0 flex-1">
          Originals available · {group.count}
        </span>
        <Button variant="secondary" size="small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-gray-alpha-400">
          {group.items.map((o) => (
            <Offer key={o.version_id} offer={o} profileName={names.get(o.profile) ?? o.profile} onOpenTitle={onOpenTitle} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Offer({ offer: o, profileName, onOpenTitle }: { offer: OriginalOffer; profileName: string; onOpenTitle: (id: number) => void }) {
  const accept = useAcceptOffer()
  const dismiss = useDismissOffer()
  const units = offerUnits(o)
  const busy = accept.isPending || dismiss.isPending
  const failed = accept.error ?? dismiss.error
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 max-sm:basis-full">
          <button type="button" title="Open the Title" onClick={() => onOpenTitle(o.title_id)} className="font-medium hover:underline">
            {o.title}
          </button>{' '}
          · {slotLabel[o.slot]} · {profileName}
        </span>
        <Button variant="secondary" size="small" disabled={busy} onClick={() => accept.mutate(o.version_id)} className="max-sm:flex-1">
          Accept
        </Button>
        <Button variant="secondary" size="small" disabled={busy} onClick={() => dismiss.mutate(o.version_id)} className="max-sm:flex-1">
          Dismiss
        </Button>
      </div>
      <div className="label-12-mono truncate text-gray-900" title={o.release}>
        {o.release} · Score {o.score}
      </div>
      {units && <div className="label-12 text-gray-900">{units}</div>}
      {failed && <Note variant="error">{failed.message}</Note>}
    </li>
  )
}
