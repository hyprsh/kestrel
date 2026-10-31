// The Toast of a search this tab started ("Search all Wanted", the Search job's Run now): one Toast that follows
// the pass live from the `search` status, then turns into a short summary. A pass the Search loop starts on its own
// shows none. The Toast's body reads the status itself, so it updates in place and a Toast the user dismissed stays gone.
import { Progress, useToasts } from '@hyprsh/design'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useJobs } from '../api/jobs'
import { useSearchStatus, type SearchStatus } from '../api/search'
import { useOpenPlace } from '../place'
import { passResult, phaseOf, releasesLine } from './SearchProgress'

const PROGRESS = 'search-progress'
const DONE = 'search-done'

/** The pass this tab is following: set by `watch`, cleared when the pass has finished. */
let following: { lastFinished: string | null; since: number } | null = null

/** "Searching 3 of 12 Wanted · 418 releases checked · 1 Grab", with a slim bar, or the queued line before the pass starts. */
function ToastBody({ queued }: { queued: string }) {
  const pass = useSearchStatus().data?.pass
  if (!pass) return <>{queued}</>
  const phase = phaseOf(pass)
  return (
    <span className="flex flex-col gap-2">
      <span>{`Searching ${phase.done} of ${phase.total} ${phase.ofLabel} · ${releasesLine(pass.releases_seen, pass.grabbed)}`}</span>
      <Progress value={phase.done} max={Math.max(phase.total, 1)} type="success" height={4} aria-label="Search progress" />
    </span>
  )
}

/** Starts following the pass a search started here kicks: shows the Toast, with `queued` until the pass begins. */
export function useWatchSearch() {
  const qc = useQueryClient()
  const toasts = useToasts()
  const open = useOpenPlace()
  return useCallback(
    (queued: string) => {
      following = { lastFinished: qc.getQueryData<SearchStatus>(['search'])?.last_pass?.finished_at ?? null, since: Date.now() }
      toasts.message({ id: PROGRESS, text: <ToastBody queued={queued} />, preserve: true, action: { label: 'Watch in Health', onClick: () => open('/health/jobs') } })
    },
    [qc, toasts, open],
  )
}

/** Mounted once, in the Shell: when the followed pass has finished, swaps the Toast for its summary (or an error). */
export function useSearchPassToast() {
  const toasts = useToasts()
  const status = useSearchStatus().data
  const jobs = useJobs().data
  useEffect(() => {
    const f = following
    if (!f || !status || status.pass) return
    const last = status.last_pass
    if (!last || last.finished_at === f.lastFinished) return
    following = null
    toasts.dismiss(PROGRESS)
    const failed = jobs?.items.find((j) => j.name === 'search')?.last_run
    if (failed?.error && Date.parse(failed.finished_at) >= f.since - 1000) toasts.error(`Search failed: ${failed.error}`)
    else toasts.success({ id: DONE, text: `Search done: ${passResult(last)}` })
  }, [status, jobs, toasts])
  // Nothing is followed once the Shell is gone (a sign-out).
  useEffect(() => () => void (following = null), [])
}
