// "Search all Wanted" as one action for a button or a menu item: it queues every Wanted Version for a search now and
// follows the pass in a Toast. Not gated on what is due: the Wanted Versions waiting out their back-off are searched too.
import { useToasts } from '@hyprsh/design'
import { useSearchStatus } from '../api/search'
import { useSearchAllWanted } from '../api/wanted'
import { useWatchSearch } from './searchToast'

export function useSearchAll() {
  const searchAll = useSearchAllWanted()
  const toasts = useToasts()
  const watch = useWatchSearch()
  const running = useSearchStatus().data?.pass != null
  return {
    pending: searchAll.isPending,
    /** True while a pass runs or this one is being queued. */
    blocked: running || searchAll.isPending,
    why: running ? 'A search pass is running' : undefined,
    run: () =>
      searchAll.mutate(undefined, {
        onSuccess: (versions) => watch(`${versions} Wanted ${versions === 1 ? 'Version' : 'Versions'} queued for a search`),
        onError: (e) => toasts.error(`Search all Wanted failed: ${e.message}`),
      }),
  }
}
