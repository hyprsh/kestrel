// How an action tells the user what it did, as Toasts. One rule:
//   - background work started: `started`, with a link to Activity;
//   - an effect the screen does not show in place: `done`, with Undo where the API can reverse it;
//   - an effect the screen shows in place: nothing;
//   - any failure: `failed`, never silent.
// The words of TRaSH's own Toasts live in trash/toasts.ts and follow the same shape.
import { useToasts } from '@hyprsh/design'
import { useOpenPlace } from './place'
import { watchInActivity } from './trash/toasts'

export type Report<T = unknown> = {
  /** Background work began: "Search started for Dune". The Toast links to Background jobs in Activity. A function that returns '' means nothing started, and `done` reports instead. */
  started?: string | ((result: T) => string)
  /** The action finished and nothing on screen shows it: "Grab cancelled". */
  done?: string | ((result: T) => string)
  /** Makes the `done` Toast a warning, for a result that only half worked. */
  warn?: (result: T) => boolean
  /** Offered in the `done` Toast, only where the API already reverses the change. */
  undo?: () => void
  /** The start of the error Toast, followed by the server's reason: "Could not search". Left out where the form shows the error inline. */
  failed?: string
}

/**
 * Reports a mutation's outcome as a Toast. Pass `mutateAsync`'s promise, not `mutate`'s per-call
 * callbacks: those die with the component, and a confirm dialog's closes on confirm. Resolves to
 * the result, or to undefined after an error Toast, so the caller never has to catch.
 */
export function useReport() {
  const toasts = useToasts()
  const open = useOpenPlace()
  return <T>(work: Promise<T>, r: Report<T>): Promise<T | undefined> =>
    work.then(
      (v) => {
        const started = typeof r.started === 'function' ? r.started(v) : r.started
        if (started) toasts.message({ text: started, action: watchInActivity(open) })
        else if (r.done) {
          const text = typeof r.done === 'function' ? r.done(v) : r.done
          if (r.warn?.(v)) toasts.warning(text)
          else toasts.success(r.undo ? { text, onUndoAction: r.undo } : text)
        }
        return v
      },
      (e: unknown) => {
        if (r.failed) toasts.error(`${r.failed}: ${e instanceof Error ? e.message : 'Request failed'}`)
        return undefined
      },
    )
}
