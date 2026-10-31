// The household-wide view defaults from Settings > Display, the same for every browser. They are only where
// a view starts: what a person picks on a screen (a season opened, a sort, a filter) still wins.
import { useSettings, type Settings } from '../api/queries'

export type Display = Settings['display']

/** What a household that never opened Display has: how the views behaved before the setting existed. */
const defaultDisplay: Display = {
  season_order: 'oldest_first',
  seasons_open: 'latest_and_wanted',
  manual_search_sort: 'best_first',
  upcoming_filters: { kind: 'all', wanted_only: false, hide_imported: false },
}

/** The Display settings, and whether they have loaded. Until then, and if they cannot load, the defaults stand. */
export function useDisplay(): { display: Display; ready: boolean } {
  const { data, isPending } = useSettings()
  return { display: data?.display ?? defaultDisplay, ready: !isPending }
}
