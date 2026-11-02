// The Title page's status badges: what is missing, downloading and coming, from data the page already has.
import { Badge } from '@hyprsh/design'
import { useSetMovieMonitored } from '../api/titleActions'
import { placePath, useOpenPlace } from '../place'
import { ago, span, useNow } from '../time'
import { useEpisodes, type TitleDetail } from '../api/queries'
import { plural } from '../format'
import { episodeCode, seasonStanding } from './episodes'
import { dotOf } from './bits'
import { FileDetailsPopover } from './EpisodeFilePopover'
import { SlotChips, stateWord, type ChipData } from './SlotChip'
import { SlotPopover, type SlotAction } from './SlotPopover'
import type { ManualSearchTarget } from './TitleDetail'
import { useSearchWanted } from './VersionSearch'
import { foundText } from './WantedLine'
import { slotsOf, useSlotNames } from './slots'
import { downloadsOf, useTitleDownloads } from './TitleDownloads'

const day = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' })

/** "Mon, Nov 2" for a date as the API gives it ("2026-11-02"). */
const dayName = (date: string) => day.format(new Date(`${date}T00:00:00`))

const today = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A Series' "Wanted" in amber, "downloading" in blue and the next episode to air in gray; a Movie's a chip per Slot (STD, "4K 40%", "DE Wanted") and its release ("Released: …", or the next one). */
export function TitleBadges({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (t: ManualSearchTarget) => void }) {
  return title.kind === 'series' ? <SeriesBadges title={title} /> : <MovieBadges title={title} profileName={profileName} onManualSearch={onManualSearch} />
}

/** The pills of a header, in one style for a Series and a Movie: Wanted amber, downloading blue, the date gray. */
function Pills({ wanted, downloading, date }: { wanted: string | null; downloading: string | null; date: string | null }) {
  if (!wanted && !downloading && !date) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {wanted && (
        <Badge variant="amber" contrast="low" size="sm">
          {wanted}
        </Badge>
      )}
      {downloading && (
        <Badge variant="blue" contrast="low" size="sm">
          {downloading}
        </Badge>
      )}
      {date && (
        <Badge variant="gray" contrast="low" size="sm">
          {date}
        </Badge>
      )}
    </div>
  )
}

function SeriesBadges({ title }: { title: TitleDetail }) {
  const episodes = useEpisodes(title.id).data ?? []
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const standing = seasonStanding(
    episodes,
    title.versions.map((v) => v.slot),
  )
  const pct = downloadsOf(downloads.all).pct
  const next = episodes
    .filter((e) => e.air_date !== null && e.air_date >= today(now))
    .sort((a, b) => (a.air_date as string).localeCompare(b.air_date as string) || a.season - b.season || a.number - b.number)[0]
  return (
    <Pills
      wanted={standing.wanted > 0 ? `${standing.wanted} Wanted` : null}
      downloading={standing.downloading > 0 ? `${standing.downloading} downloading${pct !== null ? ` · ${pct}%` : ''}` : null}
      date={next ? `Next: ${episodeCode(next)} · ${dayName(next.air_date as string)}` : null}
    />
  )
}

const releaseName = { premiere: 'premiere', theatrical_limited: 'limited release', theatrical: 'theatrical release', digital: 'digital release', physical: 'physical release', tv: 'TV release' }

function MovieBadges({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (t: ManualSearchTarget) => void }) {
  const downloads = useTitleDownloads(title.id)
  const slotNames = useSlotNames()
  const now = useNow()
  const search = useSearchWanted(title)
  const setMonitored = useSetMovieMonitored(title.id)
  const openPlace = useOpenPlace()
  const dates = title.release_dates.map((r) => ({ ...r, day: r.date.slice(0, 10) })).sort((a, b) => a.day.localeCompare(b.day))
  const next = dates.find((r) => r.day >= today(now))
  const out = dates[0]
  const date = next ? `Next: ${releaseName[next.type]} \u00b7 ${dayName(next.day)}` : out ? `Released: ${dayName(out.day)}` : null
  // One chip per Slot, from the Title's Versions: its short label, a state dot and the state in a word or a percent.
  const chips: ChipData[] = slotsOf(title, slotNames).map((s) => {
    const v = title.versions.find((x) => x.slot === s.key)
    const grab = downloads.slot(s.key)
    const state = grab ? 'downloading' : (v?.state ?? null)
    const since = v?.wanted_since ? Math.floor((now - new Date(v.wanted_since).getTime()) / 86_400_000) : 0
    const text = state === 'downloading' ? (grab?.pct != null ? `${grab.pct}%` : 'Downloading') : state === 'wanted' ? 'Wanted' : undefined
    const tip =
      state === 'downloading'
        ? `${s.name}: downloading${grab?.pct != null ? ` ${grab.pct}%` : ''}`
        : state === 'wanted'
          ? `${s.name}: Wanted${since >= 1 ? ` ${plural(since, 'day')}` : ''}`
          : `${s.name}: ${stateWord[state ?? ''] ?? state ?? 'no Version'}`
    const short = slotNames.several ? s.short : ''
    if (!v) return { key: s.key, short, state, text, tip }
    const label = `${s.name} Version`
    const manual = () => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
    const actions: SlotAction[] = []
    const lines: string[] = []
    let words = stateWord[state ?? ''] ?? state ?? ''
    if (v.file && !grab) {
      const file = v.file
      return {
        key: s.key,
        short,
        state,
        text,
        tip,
        wrap: (trigger) => <FileDetailsPopover label={`${s.name} file`} heading={s.name} dot={dotOf('filled', false)} file={file} trigger={trigger} onUpgrade={manual} />,
      }
    }
    if (state === 'wanted') {
      words = `Wanted${since >= 1 ? ` \u00b7 ${plural(since, 'day')}` : ''}`
      lines.push(v.last_search ? `Last searched ${ago(v.last_search.at, now)} \u00b7 ${foundText(v.last_search)}` : 'Not searched yet')
      actions.push({ label: 'Search', primary: true, run: () => search.run([v.id]) }, { label: 'Manual Search', run: manual })
    } else if (state === 'downloading') {
      words = grab?.pct != null ? `${grab.pct}%${grab.eta != null ? ` \u00b7 ${span(grab.eta * 1000)} left` : ''}` : 'Downloading'
      if (grab?.items[0]?.release_name) lines.push(grab.items[0].release_name)
      actions.push({ label: 'View in Activity', primary: true, run: () => openPlace(placePath('activity')) })
    } else if (state === 'unmonitored') {
      actions.push({ label: 'Monitor', primary: true, run: () => void setMonitored.mutateAsync(true) })
    } else if (state === 'unreleased') words = 'Not out yet'
    return {
      key: s.key,
      short,
      state,
      text,
      tip,
      wrap: (trigger) => <SlotPopover label={label} heading={`${title.title} \u00b7 ${s.name}`} state={state} text={words} lines={lines} actions={actions} trigger={trigger} />,
    }
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SlotChips chips={chips} max={chips.length} label="Slots" align="start" wrap />
      {date && (
        <Badge variant="gray" contrast="low" size="sm">
          {date}
        </Badge>
      )}
    </div>
  )
}
