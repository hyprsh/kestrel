// What adding a Title from the command menu chooses, and the words for it: the Slots with their Profiles, how a Series
// is monitored, the root folder, and the line that tells one search result from another. Pure functions, so the Title
// page, its choice lists and "Add with Defaults" (⌘↵) answer the same.
import type { LookupDetail, LookupResult, Profile, TitleCreate } from '../api/queries'
import type { components } from '../api/schema.gen'
import { plural } from '../format'
import { slotDefault, type SlotNames } from '../library/slots'

export type LookupSeries = components['schemas']['LookupSeries']

/** The Profile a Slot gets when switched on without a suggestion: its default, else the first enabled Primary-Language one (Any comes after HD in the list). */
function fallbackProfile(profiles: Profile[], want: string | undefined, taken: readonly (string | undefined)[] = []): string | undefined {
  const of = profiles.filter((p) => p.enabled && !taken.includes(p.key))
  return (of.find((p) => p.key === want) ?? of.find((p) => p.language_rule === 'primary') ?? of[0])?.key
}

// ---- How a Series starts ----

/** A monitoring mode alone, or seasons monitored at add with the mode for what arrives later. */
export type Preset = 'all' | 'future' | 'none' | 'first' | 'latest' | 'pick'

/** A preset with the seasons ticked under Pick Seasons… and whether new seasons are followed. */
export type SeasonChoice = { preset: Preset; picked: number[]; follow: boolean }

export const allEpisodes: SeasonChoice = { preset: 'all', picked: [], follow: true }

export const presets: Preset[] = ['all', 'future', 'none', 'first', 'latest', 'pick']

export const presetLabel: Record<Preset, string> = {
  all: 'All Episodes',
  future: 'Future Episodes Only',
  none: 'None',
  first: 'First Season',
  latest: 'Latest Season',
  pick: 'Pick Seasons…',
}

export const presetNote: Record<Preset, string> = {
  all: 'Every episode is Wanted, new ones too',
  future: 'Only episodes that air from today',
  none: 'Nothing is Wanted until you choose',
  first: 'Season 1 alone, nothing that comes later',
  latest: 'The season airing now, and what comes later',
  pick: 'Choose the seasons to add',
}

/** The seasons a choice monitors at add; null when the mode alone decides. */
export function seasonsOf(c: SeasonChoice, series: LookupSeries | null): number[] | null {
  switch (c.preset) {
    case 'first':
      return [1]
    case 'latest':
      return series?.latest_season ? [series.latest_season] : []
    case 'pick':
      return [...c.picked].sort((a, b) => a - b)
  }
  return null
}

/** The rule for episodes that arrive later. */
function modeOf(c: SeasonChoice): NonNullable<TitleCreate['series_monitor']> {
  switch (c.preset) {
    case 'first':
      return 'none'
    case 'latest':
      return 'future'
    case 'pick':
      return c.follow ? 'future' : 'none'
  }
  return c.preset
}

/** What a choice adds to POST /titles. */
function seasonBody(c: SeasonChoice, series: LookupSeries | null): Pick<TitleCreate, 'series_monitor' | 'seasons'> {
  const seasons = seasonsOf(c, series)
  return seasons ? { series_monitor: modeOf(c), seasons } : { series_monitor: modeOf(c) }
}

/** Switches to Pick Seasons…, starting from what the current choice monitors at add. */
export function pick(c: SeasonChoice, series: LookupSeries | null): SeasonChoice {
  return c.preset === 'pick' ? c : { preset: 'pick', picked: seasonsOf(c, series) ?? [], follow: modeOf(c) !== 'none' }
}

/** Why the season presets are off: they need the seasons the series overview lists. */
export function unavailable(o: { data?: LookupSeries | null; isPending: boolean; error: Error | null }): string | null {
  if (o.data) return null
  if (o.error) return 'Needs the series overview, which could not be loaded'
  if (o.isPending) return 'Waits for the series overview'
  return 'Needs the series overview'
}

const seasonWord = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/** The Monitor row's second line: "All Episodes", "Latest Season (2)", "Seasons 1 and 3". */
export function monitorText(c: SeasonChoice, series: LookupSeries | null): string {
  if (c.preset === 'latest' && series?.latest_season) return `${presetLabel.latest} (${series.latest_season})`
  if (c.preset === 'pick') {
    const ns = [...c.picked].sort((a, b) => a - b)
    if (ns.length === 0) return 'No Seasons Picked'
    if (ns.length === 1) return seasonWord(ns[0])
    if (ns.length > 3) return `${ns.length} Seasons`
    const names = ns.map((n) => (n === 0 ? 'Specials' : String(n)))
    return `Seasons ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  return presetLabel[c.preset]
}

/** The Monitor choice as a clause of the add summary: "all episodes", "future episodes". */
export function monitorClause(c: SeasonChoice, series: LookupSeries | null): string {
  switch (c.preset) {
    case 'all':
      return 'all episodes'
    case 'future':
      return 'future episodes'
    case 'none':
      return 'no episodes Wanted'
    case 'first':
      return 'first season'
    case 'latest':
      return series?.latest_season ? `season ${series.latest_season}` : 'latest season'
    case 'pick':
      return c.picked.length === 0 ? 'no seasons' : plural(c.picked.length, 'season')
  }
}

// ---- The Slots ----

/** What the model needs of the library to say which Profile a Slot gets. */
export type Library = { kind: LookupResult['kind']; profiles: Profile[]; slots: SlotNames }

/** The Slots a suggestion switches on, with their Profiles. */
export const pickedFrom = (s: Pick<LookupDetail, 'slots'> | undefined): Partial<Record<string, string>> => Object.fromEntries((s?.slots ?? []).map((x) => [x.slot as string, x.profile]))

/** The Profile a Slot gets in `picked`, if any. A library with one Slot has no Slot to switch off: its Version is always added, under the Profile picked, else the default. */
export function profileOf(picked: Partial<Record<string, string>>, slot: string, lib: Library): string | undefined {
  if (picked[slot]) return picked[slot]
  if (lib.slots.list.length !== 1) return undefined
  return fallbackProfile(
    lib.profiles,
    slotDefault(
      lib.slots.list.find((r) => r.id === slot),
      lib.kind,
    ),
  )
}

/** The Versions to add, in Slot order. */
export function versionsOf(picked: Partial<Record<string, string>>, lib: Library): { slot: string; profile: string }[] {
  return lib.slots.list.flatMap((r) => {
    const profile = profileOf(picked, r.id, lib)
    return profile ? [{ slot: r.id, profile }] : []
  })
}

/** What POST /titles takes to add a result. */
export function createBody(result: LookupResult, versions: { slot: string; profile: string }[], seasons: SeasonChoice, series: LookupSeries | null, root: string | null): TitleCreate {
  return {
    kind: result.kind,
    tmdb_id: result.tmdb_id,
    versions: versions as TitleCreate['versions'],
    ...(result.kind === 'series' ? seasonBody(seasons, series) : {}),
    ...(root ? { root_folder: root } : {}),
  }
}

// ---- The words ----

const statusLabel: Record<string, string> = { continuing: 'Running', ended: 'Ended', upcoming: 'Upcoming' }

/** "United States" for "US"; null for what is no country. */
function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? null
  } catch {
    return null
  }
}

/** "1 h 36 min", "45 min", "2 h". */
function runtimeText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "TMDB 7.3 from 30 votes"; '' when nobody voted yet. */
function scoreText(ratings: LookupResult['ratings']): string {
  const r = ratings.find((x) => x.source === 'tmdb' && x.value !== null)
  if (!r || r.value === null) return ''
  const votes = r.votes ? ` from ${r.votes.toLocaleString('en')} ${r.votes === 1 ? 'vote' : 'votes'}` : ''
  return `TMDB ${r.value.toFixed(1)}${votes}`
}

/** The second line of a search result, enough to tell two of one name apart: "Series · Netflix · United States · 2 seasons · TMDB 7.3 from 30 votes". */
export function resultLine(r: LookupResult): string {
  return [
    r.kind === 'series' ? 'Series' : 'Movie',
    r.network,
    countryName(r.origin_country),
    r.kind === 'series' ? (r.seasons ? plural(r.seasons, 'season') : null) : r.runtime ? runtimeText(r.runtime) : null,
    scoreText(r.ratings),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The Title page's facts line: the result's line without the score (the page links it), and a Series' episodes and status once TheTVDB has answered. */
export function factsLine(r: LookupResult, series: LookupSeries | null | undefined): string {
  const episodes = series ? series.seasons.filter((s) => s.number > 0).reduce((n, s) => n + s.episodes, 0) : 0
  const seasons = series ? series.seasons.filter((s) => s.number > 0).length : 0
  return [
    r.kind === 'series' ? 'Series' : 'Movie',
    r.network ?? series?.network,
    countryName(r.origin_country),
    r.kind === 'series' ? (seasons || r.seasons ? plural(seasons || r.seasons!, 'season') : null) : r.runtime ? runtimeText(r.runtime) : null,
    episodes ? plural(episodes, 'episode') : null,
    series?.status ? (statusLabel[series.status] ?? series.status) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
