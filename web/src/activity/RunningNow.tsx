// chrome: pending
// "Running now": the background work that has been running for over a second, the same
// list the top bar's indicator counts. Always rendered, so "/activity/running" can scroll to it.
import { Link, Spinner } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useQueue } from '../api/queue'
import type { Running } from './running'

export function RunningNow({ running, onOpenAdoption, onOpenTitle }: { running: Running[]; onOpenAdoption: () => void; onOpenTitle: (id: number) => void }) {
  const queue = useQueue().data ?? []
  // The Import loop does not say which Grab it is importing; the queue's Grabs waiting to be imported are what it works on.
  const importing = queue.filter((q) => q.phase === 'importing' && q.title_id !== null)
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
    return r.name
  }
  return (
    <section id="activity-running" aria-labelledby="activity-running-heading" className="border-b border-gray-alpha-400 px-4 py-3">
      <h2 id="activity-running-heading" className="heading-14 mb-2">
        Running now
      </h2>
      {running.length === 0 ? (
        <p className="label-12 text-gray-900">Nothing is running right now.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {running.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <Spinner size="sm" className="shrink-0 text-gray-900" />
              <span>{details(r)}</span>
              {r.progress && r.progress.total > 0 && <span className="text-gray-900 tabular-nums">{` ${r.progress.done}/${r.progress.total}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
