// The Adoption summary after a commit: what was not adopted, grouped, each entry with its folder and reason.
import { useAdoptionRows, type AdoptionOutcome, type AdoptionOutcomes } from '../api/adoption'
import { useOpenCleanup } from '../cleanup/launch'
import { Button, Entity, LoadMoreButton, Skeleton } from '@hyprsh/design'
import { skipText } from './text'

const groups: { outcome: AdoptionOutcome; title: string; why: string }[] = [
  { outcome: 'failed', title: 'Failed', why: '' },
  { outcome: 'skipped', title: 'Skipped', why: '' },
  { outcome: 'not_chosen', title: 'Not chosen', why: 'Needed a choice that nobody made' },
  { outcome: 'unticked', title: 'Left out', why: 'Left unticked' },
]

/** What Try again and Reopen do, offered while no plan is under review. */
export type FinishedActions = { onRetry: () => void; onReopen: () => void; busy: boolean }

export function Finished({ outcomes, actions }: { outcomes: AdoptionOutcomes; actions?: FinishedActions }) {
  const openCleanup = useOpenCleanup()
  const open = groups.filter((g) => outcomes[g.outcome] > 0)
  if (open.length === 0) return null
  return (
    <div className="flex flex-col gap-4">
      <p className="copy-14 text-gray-900">
        These entries were not adopted. Their files stay where they are as Unmanaged files, and the next scan finds them again. The summary stays until the next scan.
      </p>
      {open.map((g) => (
        <Group key={g.outcome} outcome={g.outcome} title={g.title} why={g.why} count={outcomes[g.outcome]} actions={actions} />
      ))}
      <div>
        <Button size="small" onClick={() => openCleanup()}>
          Clean up leftover files
        </Button>
      </div>
    </div>
  )
}

function Group({ outcome, title, why, count, actions }: { outcome: AdoptionOutcome; title: string; why: string; count: number; actions?: FinishedActions }) {
  const list = useAdoptionRows({ outcome }, true)
  const rows = list.data?.pages.flatMap((pg) => pg.items) ?? []
  const label = `${title} (${count})`
  return (
    <section aria-label={label}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="label-14">{label}</h2>
        {outcome === 'failed' && actions && (
          <Button size="small" onClick={actions.onRetry} disabled={actions.busy}>
            Try again
          </Button>
        )}
        {outcome === 'not_chosen' && actions && (
          <Button size="small" onClick={actions.onReopen} disabled={actions.busy}>
            Reopen to choose
          </Button>
        )}
      </div>
      {list.isPending ? (
        <Entity.List className="mt-2" aria-busy="true" aria-label={`${label}, loading`}>
          {[0, 1].map((i) => (
            <Entity key={i} left={<Skeleton width={16} height={16} />}>
              <Entity.Content fill title={<Skeleton width="60%" height={16} />} description={<Skeleton width="40%" height={16} />} />
            </Entity>
          ))}
        </Entity.List>
      ) : (
        <Entity.List className="mt-2" aria-label={`${label} entries`}>
          {rows.map((r) => (
            <Entity key={r.id}>
              <Entity.Content
                fill
                title={<span className="copy-13-mono break-all whitespace-normal">{r.entry}</span>}
                description={
                  <span className="copy-13 whitespace-normal">
                    {outcome === 'failed' ? (r.error ?? 'It could not be adopted') : outcome === 'skipped' ? (skipText[r.skip_reason ?? ''] ?? r.skip_reason) : why}
                  </span>
                }
              />
            </Entity>
          ))}
        </Entity.List>
      )}
      {list.hasNextPage && (
        <LoadMoreButton size="small" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Show more
        </LoadMoreButton>
      )}
    </section>
  )
}
