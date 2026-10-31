// The words of TRaSH's background work as Toasts, shared by the button that starts an update and
// the host that reports how any pass ended. Other actions that start background work reuse the same shape:
// `trashStarted`'s wording and `watchInActivity`.
import { useEffect, useRef } from 'react'
import { useToasts } from '@hyprsh/design'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs, type Job } from '../api/jobs'

/** "Updating from TRaSH in the background". */
const startedInBackground = (what: string) => `${what} in the background`

/** A Toast's action: a link to Background jobs in Activity. */
export const watchInActivity = (open: (path: string) => void) => ({ label: 'Watch in Activity', onClick: () => open('/activity/jobs') })

export const trashStarted = startedInBackground('Updating from TRaSH')

type Outcome = NonNullable<Job['outcome']>

const failed: Outcome['kind'][] = ['rejected', 'unreachable', 'failed']

/**
 * Reports each `trash` pass's outcome as a Toast, on whatever screen the user is on. Mounted once in
 * the Shell. The outcome the first jobs answer already holds is not reported: it is from before.
 */
export function useTrashOutcomeToasts() {
  const toasts = useToasts()
  const qc = useQueryClient()
  const jobs = useJobs().data
  const loaded = jobs !== undefined
  const outcome = jobs?.items.find((j) => j.name === 'trash')?.outcome ?? null
  const seen = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!loaded) return
    const at = outcome?.at ?? null
    const first = seen.current === undefined
    const was = seen.current
    seen.current = at
    if (first || !outcome || at === was) return
    // The snapshot's age, the Warning and the Profiles' Scores may all have changed.
    for (const k of ['status', 'attention', 'settings', 'library']) void qc.invalidateQueries({ queryKey: [k] })
    if (failed.includes(outcome.kind)) toasts.error(outcome.text)
    else toasts.success(outcome.text)
  }, [loaded, outcome, qc, toasts])
}
