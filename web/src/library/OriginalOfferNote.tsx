// The Original Offer indicator of a Version on the Title page: a Release with the Title's
// Original Language only is waiting for the admin in Needs attention.
import { offerUnits, type OriginalOffer } from '../api/offers'

export function OriginalOfferNote({ offer }: { offer?: OriginalOffer | null }) {
  if (!offer) return null
  const units = offerUnits(offer)
  return (
    <div className="label-12 mt-1 text-amber-900" title={`${offer.release} · Score ${offer.score}`}>
      {offer.dismissed ? 'Original available, dismissed' : 'Original available'}
      {units ? `: ${units}` : ''}
    </div>
  )
}
