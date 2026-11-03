import { Button, Input, Note, Select, SettingRow, Toggle } from '@hyprsh/design'
import { ApiError, usePatchSettings, useSettings, type Settings, type SettingsPatch } from '../api/queries'
import { manualSearchSortLabels } from '../library/bits'
import { SettingsBlock, SettingsCard } from '../layout/SettingsPage'
import { SkeletonForm, SkeletonRows } from '../loading'
import { startedInBackground, useReport } from '../toasts'
import { useDraftForm } from './draft'

type Language = Settings['language_region']['primary_language']
type Display = Settings['display']
type DisplayPatch = NonNullable<SettingsPatch['display']>

const languages: { value: Language; label: string; country: string }[] = [
  { value: 'en', label: 'English', country: 'US' },
  { value: 'de', label: 'German', country: 'DE' },
  { value: 'fr', label: 'French', country: 'FR' },
]
const languageName = (l: Language) => languages.find((x) => x.value === l)?.label ?? l

const problemText = (e: unknown) => (e instanceof ApiError && (e.status === 422 || e.status === 409) ? e.message : 'Could not save. Try again.')

/** A rejected save is told on the row and not swallowed: the draft stays so it can be fixed. */
function RowError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <Note variant="error" size="small">
      {problemText(error)}
    </Note>
  )
}

const declaredNote = (what: string) => <Note size="small">The Config File sets {what}, so it cannot be changed here. Change the file and restart Kestrel instead.</Note>

/** Settings, General, Language: the household's Primary Language and its release-date country, kept as a draft. Picking a language fills in its country. */
export function LanguageRows() {
  const { data, isError } = useSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the language settings.
      </Note>
    )
  if (!data) return <SkeletonRows count={2} />
  return <LanguageDraft saved={data.language_region} declared={data.from_config_file.language_region} />
}

function LanguageDraft({ saved, declared }: { saved: Settings['language_region']; declared: boolean }) {
  const save = usePatchSettings()
  const report = useReport()
  const pending = saved.pending_primary_language
  const { draft, set, dirty } = useDraftForm({
    id: 'language',
    saved: { language: pending ?? saved.primary_language, country: saved.release_date_country },
    labels: { language: 'Primary language', country: 'Country' },
    commit: async (d) => {
      const r = await report(save.mutateAsync({ language_region: { primary_language: d.language, release_date_country: d.country.trim().toUpperCase() } }), {
        started: (s) => (s.language_region.pending_primary_language ? startedInBackground(`Re-scoring under ${languageName(s.language_region.pending_primary_language)}`) : ''),
        done: 'Language saved',
      })
      if (r === undefined) throw save.error ?? new Error('Could not save')
    },
  })
  const off = declared || !!pending
  return (
    <>
      <SettingsCard>
        <SettingRow
          label="Primary language"
          changed={dirty('language')}
          help="Sets the audio your Profiles require, what DL and MULTi mean in release names and the language of title search. Changing it re-scores every file you already have, without renaming or searching."
        >
          <Select
            size="small"
            value={draft.language}
            disabled={off}
            onChange={(e) => {
              const language = e.target.value as Language
              set({ language, country: languages.find((l) => l.value === language)?.country ?? draft.country })
            }}
            options={languages.map((l) => ({ value: l.value, label: l.label }))}
          />
        </SettingRow>
        <SettingRow label="Country" changed={dirty('country')} help="Whose release dates decide when a Title counts as released. It follows the language until you edit it.">
          <Input size="small" aria-label="Release-date country" maxLength={2} value={draft.country} disabled={off} onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
        </SettingRow>
      </SettingsCard>
      <RowError error={save.error} />
      {pending && <Note size="small">Switching to {languageName(pending)}… Every file is re-scored first. The new Language applies when that ends, and Activity shows how far it is.</Note>}
      {declared && declaredNote('the language and country')}
    </>
  )
}

const seasonOrders: { value: Display['season_order']; label: string }[] = [
  { value: 'oldest_first', label: 'Oldest first' },
  { value: 'newest_first', label: 'Newest first' },
]

const columns: { key: keyof typeof manualSearchSortLabels; label: string }[] = [
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
      .map((dir) => ({ value: `${c.key}_${dir}` as Display['manual_search_sort'], label: manualSearchSortLabels[c.key][dir] })),
  ),
]

const upcomingDisplays: { value: Display['upcoming_display']; label: string }[] = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'month', label: 'Month' },
]

const kinds: { value: Display['upcoming_filters']['kind']; label: string }[] = [
  { value: 'all', label: 'Movies and Series' },
  { value: 'movie', label: 'Movies only' },
  { value: 'series', label: 'Series only' },
]

/**
 * Settings, General, Display: the household-wide view defaults, kept as a draft and saved together. They apply to every
 * browser on its next load and are only where a view starts: a sort picked in Manual search or a filter changed in a session still wins.
 */
export function DisplayRows() {
  const { data, isError } = useSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the display settings.
      </Note>
    )
  if (!data) return <SkeletonForm rows={4} />
  return <DisplayDraft saved={data.display} declared={data.from_config_file.display} />
}

function DisplayDraft({ saved, declared }: { saved: Display; declared: Settings['from_config_file']['display'] }) {
  const save = usePatchSettings()
  const flat = {
    season_order: saved.season_order,
    open_newest: saved.seasons_open === 'latest_and_wanted',
    manual_search_sort: saved.manual_search_sort,
    upcoming_display: saved.upcoming_display,
    kind: saved.upcoming_filters.kind,
    wanted_only: saved.upcoming_filters.wanted_only,
    hide_imported: saved.upcoming_filters.hide_imported,
  }
  const { draft, set, dirty } = useDraftForm({
    id: 'display',
    saved: flat,
    labels: {
      season_order: 'Season order',
      open_newest: 'Open the newest season',
      manual_search_sort: 'Manual search sort',
      upcoming_display: 'Upcoming starts on',
      kind: 'Upcoming shows',
      wanted_only: 'Wanted only',
      hide_imported: 'Hide imported',
    },
    commit: async (d, changed) => {
      const display: DisplayPatch = {}
      if (changed.includes('season_order')) display.season_order = d.season_order
      if (changed.includes('open_newest')) display.seasons_open = d.open_newest ? 'latest_and_wanted' : 'none'
      if (changed.includes('manual_search_sort')) display.manual_search_sort = d.manual_search_sort
      if (changed.includes('upcoming_display')) display.upcoming_display = d.upcoming_display
      const upcoming: NonNullable<DisplayPatch['upcoming_filters']> = {}
      if (changed.includes('kind')) upcoming.kind = d.kind
      if (changed.includes('wanted_only')) upcoming.wanted_only = d.wanted_only
      if (changed.includes('hide_imported')) upcoming.hide_imported = d.hide_imported
      if (Object.keys(upcoming).length > 0) display.upcoming_filters = upcoming
      await save.mutateAsync({ display })
    },
  })
  const anyDeclared = Object.values(declared).some(Boolean)
  const off = (key: keyof Display) => declared[key as keyof typeof declared]
  return (
    <>
      <SettingsCard>
        <SettingRow
          label="Season order"
          changed={dirty('season_order')}
          help="How a Series lists its seasons for everyone in the household. Newest first also reverses the episodes in each; Specials come before Season 1 oldest first, and last newest first."
        >
          <Select size="small" value={draft.season_order} disabled={off('season_order')} onChange={(e) => set({ season_order: e.target.value as Display['season_order'] })} options={seasonOrders} />
        </SettingRow>
        <SettingRow
          label="Open the newest season"
          changed={dirty('open_newest')}
          help="A Series page opens its newest season and every season with something Wanted, instead of starting with every season closed. A link to a season or an episode still opens that one."
        >
          <Toggle checked={draft.open_newest} disabled={off('seasons_open')} onChange={(open_newest) => set({ open_newest })} />
        </SettingRow>
        <SettingRow label="Manual search sort" changed={dirty('manual_search_sort')} help="How Manual search lists Releases when it opens.">
          <Select
            size="small"
            value={draft.manual_search_sort}
            disabled={off('manual_search_sort')}
            onChange={(e) => set({ manual_search_sort: e.target.value as Display['manual_search_sort'] })}
            options={sorts}
          />
        </SettingRow>
        <SettingRow
          label="Upcoming starts on"
          changed={dirty('upcoming_display')}
          help="The display Upcoming opens with. A browser that picked another display keeps its own. A phone always shows the Agenda."
        >
          <Select
            size="small"
            value={draft.upcoming_display}
            disabled={off('upcoming_display')}
            onChange={(e) => set({ upcoming_display: e.target.value as Display['upcoming_display'] })}
            options={upcomingDisplays}
          />
        </SettingRow>
        <SettingRow label="Upcoming shows" changed={dirty('kind')} help="Which Titles Upcoming starts with.">
          <Select size="small" value={draft.kind} disabled={off('upcoming_filters')} onChange={(e) => set({ kind: e.target.value as Display['upcoming_filters']['kind'] })} options={kinds} />
        </SettingRow>
        <SettingRow label="Wanted only" changed={dirty('wanted_only')} help="Upcoming starts with the Wanted entries only.">
          <Toggle checked={draft.wanted_only} disabled={off('upcoming_filters')} onChange={(wanted_only) => set({ wanted_only })} />
        </SettingRow>
        <SettingRow label="Hide imported" changed={dirty('hide_imported')} help="Upcoming starts without the entries that already have their file.">
          <Toggle checked={draft.hide_imported} disabled={off('upcoming_filters')} onChange={(hide_imported) => set({ hide_imported })} />
        </SettingRow>
      </SettingsCard>
      <RowError error={save.error} />
      {anyDeclared && declaredNote('the greyed-out settings')}
    </>
  )
}

/** Settings, General, Updates: the daily GitHub check. A switch applies at once, as it always did. */
export function UpdatesRow() {
  const { data } = useSettings()
  const save = usePatchSettings()
  const report = useReport()
  if (!data) return <SkeletonRows count={1} />
  const declared = data.from_config_file.check_github_updates
  return (
    <>
      <SettingsCard>
        <SettingRow label="Check GitHub daily" help="Once a day Kestrel asks GitHub for a newer release, security advisories and a newer TRaSH commit. Off means no request to GitHub at all.">
          <Toggle
            checked={data.check_github_updates}
            disabled={save.isPending || declared}
            onChange={(check_github_updates) => void report(save.mutateAsync({ check_github_updates }), { failed: 'Could not save the update check' })}
          />
        </SettingRow>
      </SettingsCard>
      {declared && declaredNote('this switch')}
    </>
  )
}

/** Settings, General, Setup: runs the wizard again. */
export function SetupRow({ onRunSetup }: { onRunSetup: () => void }) {
  return (
    <SettingsBlock>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h4 className="label-14 font-medium">Setup wizard</h4>
          <p className="copy-13 text-gray-900">Walk through the setup steps again. Your account stays as it is.</p>
        </div>
        <Button size="small" variant="secondary" onClick={onRunSetup}>
          Run Setup Again…
        </Button>
      </div>
    </SettingsBlock>
  )
}
