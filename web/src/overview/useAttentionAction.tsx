// Running one action the server built for an Attention row: a GET opens an SPA path, anything
// else is the run-action mutation, behind a confirm dialog when the action has one. The row in
// Needs attention and the Shell's ProjectBanner both run actions through this.
import { DestructiveActionModal, useToasts } from '@hyprsh/design'
import { useState } from 'react'
import { useRunAction, type ActionResult, type AttentionAction } from '../api/attention'

export type ActionOutcome = ActionResult & { label: string }

/**
 * `onFailure` is told of a failed run (a thrown error or an answer with `ok: false`), for a caller
 * with no row to show it on. The row's own state (`error`, `result`) is set either way.
 */
export function useAttentionAction(onOpen: (path: string) => void, onFailure?: (text: string) => void) {
  const run = useRunAction()
  const toasts = useToasts()
  // Local, so a row that a passing action clears takes its result with it; a pass is a toast instead.
  const [result, setResult] = useState<ActionOutcome | null>(null)
  // The action waiting for a yes in the dialog.
  const [asking, setAsking] = useState<AttentionAction | null>(null)

  const go = (a: AttentionAction) => {
    if (a.method === 'GET') return onOpen(a.path) // GET opens an SPA path
    setResult(null)
    // mutateAsync, not mutate's onSuccess: a passing Test clears this row, and a per-call callback dies with it.
    run.mutateAsync(a).then(
      (r) => {
        if (r.ok === true) toasts.success(`${a.label} passed${r.message ? `: ${r.message}` : ''}`)
        else {
          setResult({ ...r, label: a.label })
          if (r.ok === false) onFailure?.(`${a.label} failed${r.message ? `: ${r.message}` : ''}`)
        }
      },
      (e: Error) => onFailure?.(e.message),
    )
  }
  const act = (a: AttentionAction) => (a.confirm ? setAsking(a) : go(a))

  const dialog = asking && (
    <DestructiveActionModal
      open
      title={asking.label}
      description={asking.confirm}
      confirmLabel={asking.label}
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const a = asking
        setAsking(null)
        go(a)
      }}
    />
  )
  return { act, pending: run.isPending, error: run.isError ? run.error : null, result, dialog }
}
