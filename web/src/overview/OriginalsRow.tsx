// The Originals available group of Needs attention: one row per Version whose Profile offers a
// Release with the Title's Original Language only, with Accept and Dismiss and a link to the Title.
import { Button, Collapse, Entity, Link, Note } from '@hyprsh/design'
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
    <div data-originals className="mt-3">
      <Collapse size="small" headingLevel={4} expanded={open} onChange={setOpen} title={`Originals available · ${group.count}`}>
        {open && (
          <Entity.List>
            {group.items.map((o) => (
              <Offer key={o.version_id} offer={o} profileName={names.get(o.profile) ?? o.profile} onOpenTitle={onOpenTitle} />
            ))}
          </Entity.List>
        )}
      </Collapse>
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
    <Entity
      className="max-sm:flex-col max-sm:items-stretch"
      right={
        <>
          <Button variant="secondary" size="small" disabled={busy} onClick={() => accept.mutate(o.version_id)}>
            Accept
          </Button>
          <Button variant="secondary" size="small" disabled={busy} onClick={() => dismiss.mutate(o.version_id)}>
            Dismiss
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span>
          <Link as="button" title="Open the Title" onClick={() => onOpenTitle(o.title_id)}>
            {o.title}
          </Link>{' '}
          · {slotLabel[o.slot]} · {profileName}
        </span>
        <span className="label-12-mono truncate text-gray-900" title={o.release}>
          {o.release} · Score {o.score}
        </span>
        {units && <span className="label-12 text-gray-900">{units}</span>}
        {failed && <Note variant="error">{failed.message}</Note>}
      </div>
    </Entity>
  )
}
