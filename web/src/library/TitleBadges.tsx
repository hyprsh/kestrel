// The Title page's status badges: what is missing, downloading and coming, from data the page already has.
import { Badge } from '@hyprsh/design'
import { useEpisodes, type TitleDetail } from '../api/queries'
import { plural } from '../format'
import { useNow } from '../time'
import { episodeCode, seasonStanding } from './episodes'
import { downloadsOf, useTitleDownloads } from './TitleDownloads'

const day = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' })

/** "Mon, Nov 2" for a date as the API gives it ("2026-11-02"). */
const dayName = (date: string) => day.format(new Date(`${date}T00:00:00`))

const today = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A Series' "Wanted" in amber, "downloading" in blue and the next episode to air in gray; a Movie's the same three: "Wanted · 12 days", "Downloading · 40%" and its release ("Released: …", or the next one). Nothing shows when nothing applies. */
export function TitleBadges({ title }: { title: TitleDetail }) {
  return title.kind === 'series' ? <SeriesBadges title={title} /> : <MovieBadges title={title} />
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

function MovieBadges({ title }: { title: TitleDetail }) {
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const wanted = title.versions.filter((v) => v.state === 'wanted' && !downloads.slot(v.slot))
  const since = wanted.flatMap((v) => (v.wanted_since ? [new Date(v.wanted_since).getTime()] : []))
  const d = since.length > 0 ? Math.floor((now - Math.min(...since)) / 86_400_000) : 0
  const pct = downloadsOf(downloads.all).pct
  const dates = title.release_dates.map((r) => ({ ...r, day: r.date.slice(0, 10) })).sort((a, b) => a.day.localeCompare(b.day))
  const next = dates.find((r) => r.day >= today(now))
  const out = dates[0]
  return (
    <Pills
      wanted={wanted.length > 1 ? `${wanted.length} Wanted` : wanted.length === 1 ? `Wanted${d >= 1 ? ` · ${plural(d, 'day')}` : ''}` : null}
      downloading={downloads.all.length > 0 ? `Downloading${pct !== null ? ` · ${pct}%` : ''}` : null}
      date={next ? `Next: ${releaseName[next.type]} · ${dayName(next.day)}` : out ? `Released: ${dayName(out.day)}` : null}
    />
  )
}
