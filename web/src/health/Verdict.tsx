// chrome: domain-visual
// The verdict at the top of Health: in words, what is wrong and where it gets fixed, or a calm "All good". Red with a red
// left edge for problems, amber for warnings only; all good has no tint. No design component is a tinted callout with a
// coloured edge and an action per line (the Note is one line).
import { Button, Note } from '@hyprsh/design'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { useAttentionAction } from '../overview/useAttentionAction'
import { useOpenPlace } from '../place'
import { fixLabel, headline, type Problem } from './problems'

/** The button that takes a problem to where it is fixed. */
function Fix({ problem }: { problem: Problem }) {
  const openPlace = useOpenPlace()
  const { act, pending, error, dialog } = useAttentionAction(openPlace)
  const a = problem.action
  if (!a) return null
  return (
    <>
      <Button variant="default" size="small" className="max-sm:w-full" disabled={pending} onClick={() => act(a)}>
        {fixLabel(a)}
      </Button>
      {error && <Note variant="error">{error.message}</Note>}
      {dialog}
    </>
  )
}

/** `checks` is how many checks there are, for the all-good line; `restFine` says the one problem is the only thing wrong. */
export function Verdict({ problems, checks, restFine = false }: { problems: Problem[]; checks?: number; restFine?: boolean }) {
  if (problems.length === 0)
    return (
      <section aria-label="Verdict" data-tone="ok" className="flex items-center gap-3 rounded-lg border border-gray-alpha-400 px-4 py-3.5">
        <CircleCheck className="size-5 shrink-0 text-green-700" aria-hidden />
        <div className="flex flex-col">
          <span className="heading-16">All good</span>
          {checks !== undefined && checks > 0 && <span className="label-13 text-gray-900">{`All ${checks} checks pass.`}</span>}
        </div>
      </section>
    )
  const blocking = problems.some((p) => p.severity === 'blocking')
  const Icon = blocking ? CircleAlert : TriangleAlert
  const tint = blocking ? 'border-red-700 bg-red-100 shadow-[inset_3px_0_0_var(--red-700)]' : 'border-amber-700 bg-amber-100 shadow-[inset_3px_0_0_var(--amber-700)]'
  const alone = problems.length === 1
  return (
    <section aria-label="Verdict" data-tone={blocking ? 'blocking' : 'warning'} className={`flex items-start gap-3.5 rounded-lg border px-4.5 py-4 max-sm:px-3.5 max-sm:py-3 ${tint}`}>
      <Icon className={`mt-0.5 size-6 shrink-0 max-sm:hidden ${blocking ? 'text-red-700' : 'text-amber-700'}`} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h2 className="heading-16">{headline(problems)}</h2>
        <ul className="flex flex-col gap-2.5">
          {problems.map((p) => (
            <li key={p.key} className={`flex gap-3.5 ${alone ? 'items-center max-sm:flex-col max-sm:items-stretch' : 'items-start max-sm:flex-col max-sm:items-stretch'}`}>
              <span className="label-13 min-w-0 flex-1 text-gray-900">{alone && restFine ? `${p.sentence} Everything else is fine.` : p.sentence}</span>
              <Fix problem={p} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
