// The Originals available group of Needs attention: one row per Version whose Profile offers a
// Release with the Title's Original Language only, with Accept and Dismiss and a link to the Title.
import { Button, Link } from '@hyprsh/design'
import { offerUnits, useAcceptOffer, useDismissOffer, type OriginalOffer, type OriginalsAvailable } from '../api/offers'
import { NowLine, NowRow } from '../layout/NowCard'
import { TitlePoster } from '../poster'
import { useReport } from '../toasts'
import { profileName, slotProfile, useProfileNames } from '../library/slotProfile'
import { useSlotNames } from '../library/slots'

/** One row per Version whose Profile offers the Original Language, in the card's list under the group's line. */
export function Offers({ group, onOpenTitle }: { group: OriginalsAvailable; onOpenTitle: (id: number) => void }) {
  const names = useProfileNames()
  const slots = useSlotNames()
  return (
    <>
      {group.items.map((o) => (
        <Offer key={o.version_id} offer={o} slotProfile={slotProfile(slots.name(o.slot), profileName(names, o.profile))} onOpenTitle={onOpenTitle} />
      ))}
    </>
  )
}

function Offer({ offer: o, slotProfile, onOpenTitle }: { offer: OriginalOffer; slotProfile: string; onOpenTitle: (id: number) => void }) {
  const accept = useAcceptOffer()
  const dismiss = useDismissOffer()
  const report = useReport()
  const units = offerUnits(o)
  const busy = accept.isPending || dismiss.isPending
  return (
    <NowRow
      lead={<TitlePoster id={o.title_id} hasPoster={o.has_poster ?? false} size="xs" />}
      right={
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="tertiary"
            size="small"
            disabled={busy}
            onClick={() => void report(accept.mutateAsync(o.version_id), { done: `Accepted the original for ${o.title}`, failed: `Could not accept the original for ${o.title}` })}
          >
            Accept
          </Button>
          <Button
            variant="tertiary"
            size="small"
            disabled={busy}
            onClick={() => void report(dismiss.mutateAsync(o.version_id), { done: `Dismissed the original for ${o.title}`, failed: `Could not dismiss the original for ${o.title}` })}
          >
            Dismiss
          </Button>
        </span>
      }
    >
      <span className="label-14 min-w-0 truncate">
        <Link as="button" title="Open the Title" onClick={() => onOpenTitle(o.title_id)}>
          {o.title}
        </Link>{' '}
        · {slotProfile}
      </span>
      <span className="label-12-mono min-w-0 truncate text-gray-900" title={o.release}>
        {o.release} · Score {o.score}
      </span>
      {units && <NowLine>{units}</NowLine>}
    </NowRow>
  )
}
