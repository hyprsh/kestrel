import type { components } from '../api/schema.gen'

type SearchStatus = components['schemas']['SearchStatus']
type Pass = NonNullable<SearchStatus['pass']>
type Last = NonNullable<SearchStatus['last_pass']>

/** A running pass, started just now with nothing searched yet. */
export const passOf = (over: Partial<Pass> = {}): Pass => ({
  started_at: new Date().toISOString(),
  done: 0,
  total: 12,
  current: null,
  releases_seen: 0,
  grabbed: 0,
  upgrades_done: 0,
  upgrades_total: 0,
  ...over,
})

/** A finished pass, ended just now. */
export const lastPassOf = (over: Partial<Last> = {}): Last => ({
  finished_at: new Date().toISOString(),
  searched: 12,
  grabbed: 2,
  releases_seen: 418,
  upgrades: 0,
  duration_ms: 3 * 60_000,
  ...over,
})
