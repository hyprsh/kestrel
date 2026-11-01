// Search now for a Title's Versions: the Title page's primary Search button and a Version's own "Search now".
import { useMutation } from '@tanstack/react-query'
import { useReport } from '../toasts'
import { useSearchNow } from '../api/grabs'
import type { TitleDetail } from '../api/queries'

/**
 * Search now runs the automatic search at once for the Versions of the Title that are Wanted (a Series in full,
 * once per season); `run(ids)` searches the given Versions instead, such as every Version for Upgrades.
 */
export function useSearchWanted(title: TitleDetail) {
  const one = useSearchNow()
  const wanted = title.versions.filter((v) => v.state === 'wanted').map((v) => v.id)
  const report = useReport()
  const all = useMutation({ mutationFn: (ids: number[]) => Promise.all(ids.map((versionId) => one.mutateAsync({ versionId }))) })
  return {
    mutation: all,
    wanted,
    run: (ids: number[] = wanted) => void report(all.mutateAsync(ids), { started: `Search started for ${title.title}`, failed: `Could not search ${title.title}` }),
  }
}

/** Search now for one Version, reported as a Toast. */
export function useSearchVersion(title: TitleDetail, versionId: number) {
  const search = useSearchNow()
  const report = useReport()
  return { pending: search.isPending, run: () => void report(search.mutateAsync({ versionId }), { started: `Search started for ${title.title}`, failed: `Could not search ${title.title}` }) }
}
