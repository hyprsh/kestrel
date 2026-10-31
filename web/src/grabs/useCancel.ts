import { useCancelGrab } from '../api/queue'
import { useReport } from '../toasts'

/**
 * Cancel a Grab, with or without the Blocklist, for the three screens that list active Grabs.
 * The Grab leaves the list, so a Toast says what happened; a failure is a Toast too.
 */
export function useCancel() {
  const cancel = useCancelGrab()
  const report = useReport()
  return {
    pending: cancel.isPending,
    run: (id: number, blocklist: boolean) =>
      report(cancel.mutateAsync({ id, blocklist }), {
        done: blocklist ? 'Grab cancelled and its Release blocklisted' : 'Grab cancelled',
        failed: 'Could not cancel the Grab',
      }),
  }
}
