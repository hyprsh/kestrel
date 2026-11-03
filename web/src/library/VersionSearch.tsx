// Search now for a Title's Versions: the Title page's primary Search button and a Version's own "Search now".
import { useMutation } from '@tanstack/react-query'
import { useReport } from '../toasts'
import { useSearchNow } from '../api/grabs'
import type { TitleDetail } from '../api/queries'
import { useSlotNames, type SlotNames } from './slots'

/** How the Toast at the end of a search of one Version names it: the Title and the Slot. */
const watchOf = (title: TitleDetail, versionId: number, slotNames: SlotNames) => {
  const slot = title.versions.find((v) => v.id === versionId)?.slot
  return { what: slot ? `${title.title} in ${slotNames.name(slot)}` : title.title }
}

/**
 * Search now runs the automatic search at once for the Versions of the Title that are Wanted (a Series in full,
 * once per season); `run(ids)` searches the given Versions instead, such as every Version for Upgrades.
 */
export function useSearchWanted(title: TitleDetail) {
  const one = useSearchNow()
  const slotNames = useSlotNames()
  const wanted = title.versions.filter((v) => v.state === 'wanted').map((v) => v.id)
  const report = useReport()
  const all = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((versionId) => one.mutateAsync({ versionId, watch: watchOf(title, versionId, slotNames) }))),
  })
  return {
    mutation: all,
    wanted,
    run: (ids: number[] = wanted) => void report(all.mutateAsync(ids), { started: `Search started for ${title.title}`, failed: `Could not search ${title.title}` }),
  }
}

/** Search now for one Version, reported as a Toast. */
export function useSearchVersion(title: TitleDetail, versionId: number) {
  const search = useSearchNow()
  const slotNames = useSlotNames()
  const report = useReport()
  return {
    pending: search.isPending,
    run: () => void report(search.mutateAsync({ versionId, watch: watchOf(title, versionId, slotNames) }), { started: `Search started for ${title.title}`, failed: `Could not search ${title.title}` }),
  }
}
