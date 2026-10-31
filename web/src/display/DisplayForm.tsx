import { Checkbox, Note, Select } from '@hyprsh/design'
import { ApiError, usePatchSettings, useSettings, type SettingsPatch } from '../api/queries'
import type { Display } from './useDisplay'

type Patch = NonNullable<SettingsPatch['display']>

const seasonOrders: { value: Display['season_order']; label: string }[] = [
  { value: 'oldest_first', label: 'Oldest first' },
  { value: 'newest_first', label: 'Newest first' },
]

const seasonsOpen: { value: Display['seasons_open']; label: string }[] = [
  { value: 'latest_and_wanted', label: 'Latest and Wanted' },
  { value: 'all', label: 'All' },
  { value: 'none', label: 'None' },
]

const columns = [
  { key: 'score', label: 'Score' },
  { key: 'release', label: 'Release' },
  { key: 'quality', label: 'Quality' },
  { key: 'languages', label: 'Languages' },
  { key: 'formats', label: 'Custom formats' },
  { key: 'size', label: 'Size' },
  { key: 'age', label: 'Age' },
  { key: 'indexer', label: 'Indexer' },
]

/** Best first, then each column both ways; score descending is best first. */
const sorts: { value: Display['manual_search_sort']; label: string }[] = [
  { value: 'best_first', label: 'Best first' },
  ...columns.flatMap((c) =>
    (['asc', 'desc'] as const)
      .filter((dir) => !(c.key === 'score' && dir === 'desc'))
      .map((dir) => ({ value: `${c.key}_${dir}` as Display['manual_search_sort'], label: `${c.label}, ${dir === 'asc' ? 'ascending' : 'descending'}` })),
  ),
]

const kinds: { value: Display['upcoming_filters']['kind']; label: string }[] = [
  { value: 'all', label: 'Movies and Series' },
  { value: 'movie', label: 'Movies only' },
  { value: 'series', label: 'Series only' },
]

/**
 * The household-wide view defaults (Settings, Display). Each control saves as soon as it changes and applies to
 * every browser on its next load. They are only where a view starts: a season someone opened, a sort picked in
 * Manual search or a filter changed in a session still wins.
 */
export function DisplayForm() {
  const { data, isError } = useSettings()
  const save = usePatchSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the display settings.
      </Note>
    )
  if (!data) return null
  const d = data.display
  const declared = data.from_config_file.display
  const set = (display: Patch) => save.mutate({ display })
  const off = (isDeclared: boolean) => isDeclared || save.isPending
  const anyDeclared = Object.values(declared).some(Boolean)
  return (
    <div className="flex max-w-md flex-col gap-4">
      <Select
        size="small"
        label="Season order"
        value={d.season_order}
        disabled={off(declared.season_order)}
        onChange={(e) => set({ season_order: e.target.value as Display['season_order'] })}
        options={seasonOrders}
      />
      <p className="copy-13 text-gray-900">Newest first reverses the seasons and the episodes in each, so the latest episode is at the top. Specials come last either way.</p>
      <Select
        size="small"
        label="Seasons open by default"
        value={d.seasons_open}
        disabled={off(declared.seasons_open)}
        onChange={(e) => set({ seasons_open: e.target.value as Display['seasons_open'] })}
        options={seasonsOpen}
      />
      <p className="copy-13 text-gray-900">
        Latest and Wanted opens the latest season and any season with a Wanted episode, never Specials. A season someone opens or closes stays that way for that Series in their browser.
      </p>
      <Select
        size="small"
        label="Manual search sort"
        value={d.manual_search_sort}
        disabled={off(declared.manual_search_sort)}
        onChange={(e) => set({ manual_search_sort: e.target.value as Display['manual_search_sort'] })}
        options={sorts}
      />
      <div role="group" aria-labelledby="display-upcoming" className="flex flex-col gap-2">
        <fieldset disabled={off(declared.upcoming_filters)} className="contents">
          <p id="display-upcoming" className="label-13">
            Upcoming filters
          </p>
          <Select size="small" label="Show" value={d.upcoming_filters.kind} onChange={(e) => set({ upcoming_filters: { kind: e.target.value } })} options={kinds} />
          <Checkbox checked={d.upcoming_filters.wanted_only} onChange={(e) => set({ upcoming_filters: { wanted_only: e.target.checked } })}>
            Wanted only
          </Checkbox>
          <Checkbox checked={d.upcoming_filters.hide_imported} onChange={(e) => set({ upcoming_filters: { hide_imported: e.target.checked } })}>
            Hide imported
          </Checkbox>
        </fieldset>
      </div>
      <p className="copy-13 text-gray-900">Manual search and Upcoming start from these. A sort or filter someone picks lasts for their browser session.</p>
      {save.isError && (
        <Note variant="error" size="small">
          {save.error instanceof ApiError && (save.error.status === 422 || save.error.status === 409) ? save.error.message : 'Could not save. Try again.'}
        </Note>
      )}
      {anyDeclared && <Note size="small">The Config File sets the greyed-out settings, so they cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </div>
  )
}
