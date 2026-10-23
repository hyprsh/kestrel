// The Adoption summary after a commit: what was not adopted, grouped, each entry with its folder and reason.
import { useOutcomeRows, type AdoptionOutcome } from '../api/adoption'
import type { components } from '../api/schema.gen'
import { useOpenCleanup } from '../cleanup/launch'
import { Button, Spinner } from '@hyprsh/design'
import { skipText } from './text'

type Outcomes = components['schemas']['AdoptionOutcomes']

const groups: { outcome: AdoptionOutcome; title: string; why: string }[] = [
  { outcome: 'failed', title: 'Failed', why: '' },
  { outcome: 'skipped', title: 'Skipped', why: '' },
  { outcome: 'not_chosen', title: 'Not chosen', why: 'Needed a choice that nobody made' },
  { outcome: 'unticked', title: 'Left out', why: 'Left unticked' },
]

export function Finished({ outcomes, onRetry, onScan, busy }: { outcomes: Outcomes; onRetry: () => void; onScan: () => void; busy: boolean }) {
  const openCleanup = useOpenCleanup()
  const open = groups.filter((g) => outcomes[g.outcome] > 0)
  if (open.length === 0) return null
  return (
    <div className="flex flex-col gap-4">
      <p className="copy-14 text-gray-900">
        These entries were not adopted. Their files stay where they are as Unmanaged files, and the next scan finds them again.
      </p>
      {open.map((g) => (
        <Group key={g.outcome} outcome={g.outcome} title={g.title} why={g.why} count={outcomes[g.outcome]} onRetry={onRetry} onScan={onScan} busy={busy} />
      ))}
      <div>
        <Button size="small" onClick={() => openCleanup()}>
          Clean up leftover files
        </Button>
      </div>
    </div>
  )
}

function Group({
  outcome,
  title,
  why,
  count,
  onRetry,
  onScan,
  busy,
}: {
  outcome: AdoptionOutcome
  title: string
  why: string
  count: number
  onRetry: () => void
  onScan: () => void
  busy: boolean
}) {
  const list = useOutcomeRows(outcome, true)
  const rows = list.data?.pages.flatMap((pg) => pg.items) ?? []
  const label = `${title} (${count})`
  return (
    <section aria-label={label}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="label-14">{label}</h2>
        {outcome === 'failed' && (
          <Button size="small" onClick={onRetry} disabled={busy}>
            Try again
          </Button>
        )}
        {outcome === 'not_chosen' && (
          <Button size="small" onClick={onScan} disabled={busy}>
            Scan again to choose
          </Button>
        )}
      </div>
      {list.isPending ? (
        <div className="copy-13 mt-2 flex items-center gap-2 text-gray-900">
          <Spinner size="sm" />
          Loading…
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
          {rows.map((r) => (
            <li key={r.id} className="p-3">
              <div className="copy-13-mono break-all">{r.entry}</div>
              <div className="copy-13 mt-0.5 text-gray-900">
                {outcome === 'failed' ? (r.error ?? 'It could not be adopted') : outcome === 'skipped' ? (skipText[r.skip_reason ?? ''] ?? r.skip_reason) : why}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button size="small" className="mt-2" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Show more
        </Button>
      )}
    </section>
  )
}
