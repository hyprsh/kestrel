// The Originals available group of Needs attention: one row per Version whose Profile offers a
// Release with the Title's Original Language only, with Accept and Dismiss and a link to the Title.
import { Button, Collapse, Entity, Link, Note } from '@hyprsh/design'
import { RowList, stackedRow, stackedRight } from '../layout/RowList'
import { useState } from 'react'
import { offerUnits, useAcceptOffer, useDismissOffer, type OriginalOffer, type OriginalsAvailable } from '../api/offers'
import { profileName, slotProfile, useProfileNames } from '../library/slotProfile'

/**
 * Like Long Missing, one grouped row after the others and outside the rail
 * badge. It expands to one row per Version, best Release first.
 */
export function OriginalsRow({ group, onOpenTitle }: { group: OriginalsAvailable; onOpenTitle: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const names = useProfileNames()
  return (
    <div data-originals className="mt-3">
      <Collapse size="small" headingLevel={4} expanded={open} onChange={setOpen} title={`Originals available · ${group.count}`}>
        {open && (
          <RowList>
            {group.items.map((o) => (
              <Offer key={o.version_id} offer={o} slotProfile={slotProfile(o.slot, profileName(names, o.profile))} onOpenTitle={onOpenTitle} />
            ))}
          </RowList>
        )}
      </Collapse>
    </div>
  )
}

function Offer({ offer: o, slotProfile, onOpenTitle }: { offer: OriginalOffer; slotProfile: string; onOpenTitle: (id: number) => void }) {
  const accept = useAcceptOffer()
  const dismiss = useDismissOffer()
  const units = offerUnits(o)
  const busy = accept.isPending || dismiss.isPending
  const failed = accept.error ?? dismiss.error
  return (
    <Entity
      className={stackedRow}
      rightClassName={stackedRight}
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
          · {slotProfile}
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
