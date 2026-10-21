// The Searching card: the search pipeline at a glance, beside Downloading now.
import { useEffect, useState } from 'react'
import { useSearchStatus, type SearchStatus } from '../api/search'

type Indexer = SearchStatus['indexers'][number]

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "in 3 min", "in 1 h 5 min"; "any moment" once it is due. */
function startsIn(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000)
  if (mins < 1) return 'any moment'
  if (mins < 60) return `in ${mins} min`
  return `in ${Math.floor(mins / 60)} h ${mins % 60} min`
}

/** Re-renders every half minute, so "next pass in 3 min" counts down between frames. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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

export function Searching() {
  const s = useSearchStatus().data
  const now = useNow()
  if (!s) return null
  const main = [
    s.due.versions > 0 ? `${s.due.versions} Wanted waiting` : 'Nothing waiting',
    s.pass ? `searching ${s.pass.done} of ${s.pass.total}` : null,
    s.next_pass_at ? `next pass ${startsIn(s.next_pass_at, now)}` : null,
  ].filter(Boolean)
  const held = s.indexers.map(heldLine).filter((l): l is string => l !== null)
  return (
    <section id="overview-searching" aria-labelledby="searching" className="mx-auto mb-8 max-w-3xl">
      <h2 id="searching" className="mb-3 text-sm font-medium">
        Searching
      </h2>
      <div className="flex flex-col gap-1 rounded-lg border border-gray-alpha-400 px-4 py-3">
        <p className="font-medium">{main.join(' · ')}</p>
        {s.due.episodes > 0 && <p className="text-[12px] text-gray-900">{`${plural(s.due.episodes, 'Wanted episode')} in the Series among them`}</p>}
        {s.due.upgrades > 0 && (
          <p className="text-[12px] text-gray-900">
            {`${plural(s.due.upgrades, 'Version')} due an Upgrade search · ${plural(s.upgrades_per_pass, 'Upgrade search', 'Upgrade searches')} per pass`}
          </p>
        )}
        {s.last_pass && (
          <p className="text-[12px] text-gray-900">
            {`Last pass at ${clockTime(s.last_pass.finished_at)} searched ${plural(s.last_pass.searched, 'Wanted Version')} and made ${plural(s.last_pass.grabbed, 'Grab')}`}
          </p>
        )}
        {held.map((l) => (
          <p key={l} className="text-[12px] text-amber-900">
            {l}
          </p>
        ))}
      </div>
    </section>
  )
}
