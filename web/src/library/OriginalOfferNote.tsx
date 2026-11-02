// The Original Offer of a Version on the Title page: a Release with the Title's Original Language only is
// waiting for the admin, who can accept it here or in Needs attention.
import { Button, Entity } from '@hyprsh/design'
import { Languages } from 'lucide-react'
import { offerUnits, useAcceptOffer, useDismissOffer, type OriginalOffer } from '../api/offers'
import { useReport } from '../toasts'
import { useSlotNames } from './slots'

/** A slim row under its Version (`row` makes it a row of the Versions list): the offer in words, Accept and, while it is open, Dismiss. */
export function OriginalOfferNote({ offer, row = false }: { offer?: OriginalOffer | null; row?: boolean }) {
  const accept = useAcceptOffer()
  const dismiss = useDismissOffer()
  const report = useReport()
  const slots = useSlotNames()
  if (!offer) return null
  const units = offerUnits(offer)
  const busy = accept.isPending || dismiss.isPending
  const note = (
    <div className="label-13 flex min-w-0 flex-1 items-center gap-3" title={offer.release}>
      <Languages aria-hidden className="size-4 shrink-0 text-gray-900" />
      <span className="min-w-0 flex-1">
        {`A ${slots.name(offer.slot)} release in the original language only is available${units ? `: ${units}` : ''} · Score ${offer.score}${offer.dismissed ? ' · Dismissed' : ''}`}
      </span>
      <Button
        variant="secondary"
        size="small"
        disabled={busy}
        onClick={() => void report(accept.mutateAsync(offer.version_id), { done: 'Original accepted', failed: 'Could not accept the original' })}
      >
        Accept
      </Button>
      {!offer.dismissed && (
        <Button
          variant="tertiary"
          size="small"
          disabled={busy}
          onClick={() => void report(dismiss.mutateAsync(offer.version_id), { done: 'Original dismissed', failed: 'Could not dismiss the original' })}
        >
          Dismiss
        </Button>
      )}
    </div>
  )
  return row ? <Entity>{note}</Entity> : note
}
