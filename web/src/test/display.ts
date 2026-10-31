// The Display settings a household that never opened Display has, for the /settings fixtures.
export const displayDefaults = {
  season_order: 'oldest_first',
  seasons_open: 'latest_and_wanted',
  manual_search_sort: 'best_first',
  upcoming_filters: { kind: 'all', wanted_only: false, hide_imported: false },
} as const

export const noDisplayDeclared = { season_order: false, seasons_open: false, manual_search_sort: false, upcoming_filters: false }
