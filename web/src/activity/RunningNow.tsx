// chrome: domain-visual
// "Running now": the background work that has been running for over a second, the same list the top bar's indicator
// counts, as compact rows: what it is, what it is on and, when it counts, a Progress with "1 of 4". Health shows it
// first. No design component is a bordered row with a name, a Progress and a count (Entity is a list row).
import { Link, Progress, Spinner } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { plural } from '../format'
import { SectionBlock } from '../layout/SectionBlock'
import type { Running } from './running'

export function RunningNow({ running, onOpenAdoption, onOpenTitle }: { running: Running[]; onOpenAdoption: () => void; onOpenTitle: (id: number) => void }) {
  const queue = useQueue().data ?? []
  // The Import loop does not say which Grab it is importing; the queue's Grabs waiting to be imported are what it works on.
  const importing = queue.filter((q) => q.phase === 'importing' && q.title_id !== null)
  /** The search pass says what it is on and how many releases it has checked, after its name. */
  const aside = (r: Running): string | null => {
    const parts = [r.now?.replace(/^Now:\s*/, 'now '), r.releases != null && r.releases > 0 ? plural(r.releases, 'release') + ' checked' : null].filter(Boolean)
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : null
  }
  const details = (r: Running): ReactNode => {
    if (r.key.startsWith('adoption-'))
      return (
        <Link as="button" onClick={onOpenAdoption}>
          {r.name}
        </Link>
      )
    if (r.key === 'import' && importing.length > 0)
      return (
        <>
          {`${r.name} · `}
          {importing.map((q, i) => (
            <span key={q.grab_id}>
              {i > 0 && ', '}
              <Link as="button" onClick={() => onOpenTitle(q.title_id!)}>
                {q.title}
              </Link>
            </span>
          ))}
        </>
      )
    return (
      <>
        <b className="font-medium">{r.name}</b>
        <span className="text-gray-900">{aside(r)}</span>
      </>
    )
  }
  return (
    <div>
      <SectionBlock title="Running now" count={running.length}>
        {running.length === 0 ? (
          <p className="label-13 text-gray-900">Nothing is running right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {running.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-alpha-400 px-4 py-3">
                <Spinner size="sm" className="shrink-0 text-gray-900" />
                <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">{details(r)}</span>
                {r.progress && r.progress.total > 0 && (
                  <>
                    <Progress value={r.progress.done} max={r.progress.total} type="success" height={6} aria-label={`${r.name} progress`} className="w-48 max-sm:w-auto max-sm:flex-1" />
                    <span className="label-12 w-16 text-right text-gray-900 tabular-nums">{`${r.progress.done} of ${r.progress.total}`}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionBlock>
    </div>
  )
}
