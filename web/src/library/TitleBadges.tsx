// The Title page's status badges: what is missing, downloading and coming, from data the page already has.
import { Badge } from '@hyprsh/design'
import { useEpisodes, type TitleDetail } from '../api/queries'
import { plural } from '../format'
import { useNow } from '../time'
import { slotLabel } from './bits'
import { episodeCode, seasonStanding } from './episodes'
import { downloadsOf, useTitleDownloads } from './TitleDownloads'

const day = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' })

/** "Mon, Nov 2" for a date as the API gives it ("2026-11-02"). */
const dayName = (date: string) => day.format(new Date(`${date}T00:00:00`))

const today = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Wanted" in amber, "downloading" in blue and for a Series the next episode to air in gray. Nothing shows when nothing applies. */
export function TitleBadges({ title }: { title: TitleDetail }) {
  return title.kind === 'series' ? <SeriesBadges title={title} /> : <MovieBadges title={title} />
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
  if (standing.wanted === 0 && standing.downloading === 0 && !next) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {standing.wanted > 0 && (
        <Badge variant="amber" contrast="low" size="sm">
          {`${standing.wanted} Wanted`}
        </Badge>
      )}
      {standing.downloading > 0 && (
        <Badge variant="blue" contrast="low" size="sm">
          {`${standing.downloading} downloading${pct !== null ? ` · ${pct}%` : ''}`}
        </Badge>
      )}
      {next && (
        <Badge variant="gray" contrast="low" size="sm">
          {`Next: ${episodeCode(next)} · ${dayName(next.air_date as string)}`}
        </Badge>
      )}
    </div>
  )
}

function MovieBadges({ title }: { title: TitleDetail }) {
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const badges = title.versions.flatMap((v): { key: number; tone: 'blue' | 'amber'; text: string }[] => {
    const dl = downloads.slot(v.slot)
    if (dl) return [{ key: v.id, tone: 'blue', text: `${slotLabel[v.slot]} downloading${dl.pct !== null ? ` · ${dl.pct}%` : ''}` }]
    if (v.state !== 'wanted') return []
    const d = v.wanted_since ? Math.floor((now - new Date(v.wanted_since).getTime()) / 86_400_000) : 0
    return [{ key: v.id, tone: 'amber', text: `${slotLabel[v.slot]} Wanted${d >= 1 ? ` · ${plural(d, 'day')}` : ''}` }]
  })
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <Badge key={b.key} variant={b.tone} contrast="low" size="sm">
          {b.text}
        </Badge>
      ))}
    </div>
  )
}
