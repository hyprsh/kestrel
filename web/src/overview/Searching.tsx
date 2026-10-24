// The Searching card: the search pipeline at a glance, beside Downloading now.
import { Description, Pill } from '@hyprsh/design'
import { useSearchStatus, type SearchStatus } from '../api/search'
import { plural } from '../format'
import { useOpenPlace } from '../place'
import { clockTime, until, useNow } from '../time'

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

export function Searching() {
  const s = useSearchStatus().data
  const openPlace = useOpenPlace()
  if (!s) return null
  return (
    <section id="overview-searching" aria-labelledby="searching">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="searching" className="heading-14">
          Searching
        </h2>
        {/* The Search loop's schedule and last run sit with the other loops on Activity. */}
        <Pill onClick={() => openPlace('/activity/jobs')}>Background jobs</Pill>
      </div>
      <SearchSummary status={s} />
    </section>
  )
}

/** The search pipeline in a few lines: what waits, the pass, the last pass and the indexers' budgets. Activity's Searching stage shows it too. */
export function SearchSummary({ status: s }: { status: SearchStatus }) {
  const now = useNow()
  const main = [
    s.due.versions > 0 ? `${s.due.versions} Wanted waiting` : 'Nothing waiting',
    s.pass ? `searching ${s.pass.done} of ${s.pass.total}` : null,
    s.next_pass_at ? `next pass ${until(s.next_pass_at, now)}` : null,
  ].filter(Boolean)
  const indexers = s.indexers.map(indexerLine).filter((l) => l !== null)
  return (
    <div className="flex flex-col gap-3">
      <Description layout="horizontal" termWidth={96} title="Waiting" content={main.join(' · ')} />
      {s.due.episodes > 0 && <Description layout="horizontal" termWidth={96} title="Episodes" content={`${plural(s.due.episodes, 'Wanted episode')} in the Series among them`} />}
      {s.due.upgrades > 0 && (
        <Description
          layout="horizontal"
          termWidth={96}
          title="Upgrades"
          content={`${plural(s.due.upgrades, 'Version')} due an Upgrade search · ${plural(s.upgrades_per_pass, 'Upgrade search', 'Upgrade searches')} per pass`}
        />
      )}
      {s.last_pass && (
        <Description
          layout="horizontal"
          termWidth={96}
          title="Last Pass"
          content={`Last pass at ${clockTime(s.last_pass.finished_at)} searched ${plural(s.last_pass.searched, 'Wanted Version')} and made ${plural(s.last_pass.grabbed, 'Grab')}`}
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
