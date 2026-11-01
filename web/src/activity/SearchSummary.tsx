// The search pipeline in a few lines, in Activity's Searching stage.
import { Description } from '@hyprsh/design'
import type { SearchStatus } from '../api/search'
import { plural } from '../format'
import { clockTime } from '../time'
import { SearchProgress } from './SearchProgress'

type Indexer = SearchStatus['indexers'][number]

/** Why sweeps leave an indexer alone, or null when they don't. */
function heldLine(i: Indexer): string | null {
  switch (i.held) {
    case 'request_limit':
      return `${i.name} paused until ${i.held_until ? clockTime(i.held_until) : 'further notice'} (request limit)`
    case 'backing_off':
      return `${i.name} backing off after errors${i.held_until ? ` until ${clockTime(i.held_until)}` : ''}`
    case 'budget':
      return `${i.name} out of budget for sweeps: ${i.search_used} of ${i.search_max ?? '?'} searches today`
    default:
      return null
  }
}

/** "30 of 500 searches left today", or null when the indexer's limit is not known. */
function budgetLeft(i: Indexer): string | null {
  return i.search_max == null ? null : `${Math.max(0, i.search_max - i.search_used)} of ${i.search_max} searches left today`
}

/** One line per indexer worth a word: what holds its sweeps back, and its budget left when known. */
function indexerLine(i: Indexer): { text: string; held: boolean } | null {
  const held = heldLine(i)
  // The budget hold already counts the searches.
  const left = i.held === 'budget' ? null : budgetLeft(i)
  if (held) return { text: left ? `${held} · ${left}` : held, held: true }
  return left ? { text: `${i.name}: ${left}`, held: false } : null
}

/** The search pipeline in a few lines: the pass or what waits and the last pass (SearchProgress), then the indexers' budgets. Activity's Searching stage shows it too. */
export function SearchSummary({ status: s, onOpenTitle }: { status: SearchStatus; onOpenTitle?: (id: number) => void }) {
  const indexers = s.indexers.map(indexerLine).filter((l) => l !== null)
  return (
    <div className="flex flex-col gap-3">
      <SearchProgress status={s} onOpenTitle={onOpenTitle} />
      {s.due.episodes > 0 && <Description layout="horizontal" termWidth={96} title="Episodes" content={`${plural(s.due.episodes, 'Wanted episode')} in the Series among them`} />}
      {s.due.upgrades > 0 && (
        <Description
          layout="horizontal"
          termWidth={96}
          title="Upgrades"
          content={`${plural(s.due.upgrades, 'Version')} due an Upgrade search · ${plural(s.upgrades_per_pass, 'Upgrade search', 'Upgrade searches')} per pass`}
        />
      )}
      {indexers.length > 0 && (
        <Description
          layout="horizontal"
          termWidth={96}
          title="Indexers"
          content={
            <span className="flex flex-col gap-1">
              {indexers.map((l) => (
                <span key={l.text} className={l.held ? 'text-amber-900' : undefined}>
                  {l.text}
                </span>
              ))}
            </span>
          }
        />
      )}
    </div>
  )
}
