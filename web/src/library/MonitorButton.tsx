// chrome: domain-visual
// The Title's monitoring state as a button you cannot miss, in the header beside Search. A Series' opens a menu: three radio
// choices in words (All episodes, Future episodes only, Not monitored), then switches for new seasons and Specials. A Movie's
// is one toggle. Green tint when monitored, an outline when not.
import { Button, Menu, MenuDivider, MenuItem, Toggle } from '@hyprsh/design'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SeriesMonitor, TitleDetail } from '../api/queries'
import { useEpisodes } from '../api/queries'
import { plural } from '../format'
import { slotName } from './slots'
import { useSetMovieMonitored, useSetSeriesMonitor, useSetSeriesMonitorOptions } from '../api/titleActions'
import { useReport } from '../toasts'

const on = { background: 'var(--green-100)', color: 'var(--green-900)', boxShadow: 'inset 0 0 0 1px var(--green-400)' }
const off = { background: 'var(--background-100)', color: 'var(--gray-900)', boxShadow: 'inset 0 0 0 1px var(--gray-alpha-400)' }

/** The choices of a Series' mode: the words of the menu, the button's tail and the line under the title. */
const seriesModes: { value: SeriesMonitor; label: string; description: string; tail: string }[] = [
  { value: 'all', label: 'All episodes', description: 'Search the past ones that are missing, and new ones', tail: 'all episodes' },
  { value: 'future', label: 'Future episodes only', description: 'Leave what aired before; grab what airs from now', tail: 'future episodes' },
  { value: 'none', label: 'Not monitored', description: 'Keep the files, search nothing', tail: '' },
]

/** Whether a Title is monitored: a Movie by its flag, a Series by its mode. */
export const isMonitored = (title: Pick<TitleDetail, 'kind' | 'monitored' | 'series_monitor'>) => (title.kind === 'movie' ? title.monitored : title.series_monitor !== 'none')

function Icon({ monitored }: { monitored: boolean }) {
  const I = monitored ? BookmarkCheck : Bookmark
  return <I aria-hidden className="size-4" />
}

/** "Monitored · all episodes" / "Not monitored" for a Series; "Monitored" / "Not monitored" for a Movie. `short` drops the tail (a phone's button). */
function monitorLabel(title: TitleDetail, short = false): ReactNode {
  if (!isMonitored(title)) return 'Not monitored'
  if (title.kind === 'movie') return 'Monitored'
  const tail = seriesModes.find((m) => m.value === (title.series_monitor ?? 'all'))?.tail
  if (short) return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : 'Monitored'
  return (
    <>
      Monitored <span className="font-normal">· {tail}</span>
    </>
  )
}

export function MonitorButton({ title, size = 'medium', short = false }: { title: TitleDetail; size?: 'medium' | 'large'; short?: boolean }) {
  const report = useReport()
  const movie = useSetMovieMonitored(title.id)
  const series = useSetSeriesMonitor(title.id)
  const options = useSetSeriesMonitorOptions(title.id)
  const monitored = isMonitored(title)
  const pending = movie.isPending || series.isPending || options.isPending
  const style = monitored ? on : off
  if (title.kind === 'movie') {
    return (
      <Button
        variant="secondary"
        size={size}
        style={style}
        aria-pressed={monitored}
        disabled={pending}
        prefix={<Icon monitored={monitored} />}
        onClick={() => void report(movie.mutateAsync(!monitored), { failed: 'Could not change monitoring' })}
      >
        {monitorLabel(title)}
      </Button>
    )
  }
  const mode = title.series_monitor ?? 'all'
  const set = (v: SeriesMonitor) => void report(series.mutateAsync(v), { failed: 'Could not change monitoring' })
  const flag = (patch: { monitor_new_seasons: boolean } | { monitor_specials: boolean }) => void report(options.mutateAsync(patch), { failed: 'Could not change monitoring' })
  const newSeasons = title.monitor_new_seasons ?? true
  const specials = title.monitor_specials ?? false
  return (
    <Menu.Container position="bottom-end">
      <Menu.Button
        variant="secondary"
        size={size}
        style={style}
        showChevron
        disabled={pending}
        prefix={<Icon monitored={monitored} />}
        aria-label={`Monitoring: ${monitored ? `monitored, ${seriesModes.find((m) => m.value === mode)?.tail}` : 'not monitored'}`}
      >
        {monitorLabel(title, short)}
      </Menu.Button>
      <Menu width={300} aria-label="Monitoring">
        {seriesModes.map((m) => (
          <MenuItem key={m.value} role="radio" checked={m.value === mode} description={m.description} onSelect={() => set(m.value)}>
            {m.label}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem
          role="checkbox"
          checked={newSeasons}
          suffix={<Toggle size="small" checked={newSeasons} aria-hidden tabIndex={-1} onChange={() => undefined} />}
          onSelect={() => flag({ monitor_new_seasons: !newSeasons })}
        >
          Monitor new seasons
        </MenuItem>
        <MenuItem
          role="checkbox"
          checked={specials}
          suffix={<Toggle size="small" checked={specials} aria-hidden tabIndex={-1} onChange={() => undefined} />}
          onSelect={() => flag({ monitor_specials: !specials })}
        >
          Monitor Specials
        </MenuItem>
      </Menu>
    </Menu.Container>
  )
}

/** The Movie header of a Title that is not monitored: a quiet panel, so the whole header says so. */
export function MutedFrame({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-background-200 p-4 shadow-border">{children}</div>
}

/** The line under the title that says what monitoring does: "Kestrel searches every Wanted episode and grabs new ones as they air. 4 Specials are not monitored." */
export function MonitoringLine({ title }: { title: TitleDetail }) {
  const episodes = useEpisodes(title.id, title.kind === 'series').data
  let text: string
  if (title.kind === 'movie') {
    if (!title.monitored) {
      const lacking = title.versions.filter((v) => !v.file).map((v) => slotName(v.slot))
      text = `Kestrel keeps its file and searches nothing.${lacking.length > 0 ? ` Its ${lacking.join(' and ')} ${plural(lacking.length, 'Version').replace(/^\d+ /, '')} would be Wanted.` : ''}`
    } else {
      const wanted = title.versions.filter((v) => v.state === 'wanted').map((v) => slotName(v.slot))
      text =
        wanted.length > 0
          ? `Kestrel searches the Wanted ${wanted.join(' and ')} ${plural(wanted.length, 'Version').replace(/^\d+ /, '')} and grabs Upgrades until the cutoff.`
          : 'Kestrel grabs Upgrades until the cutoff.'
    }
  } else {
    const mode = title.series_monitor ?? 'all'
    text =
      mode === 'all'
        ? 'Kestrel searches every Wanted episode and grabs new ones as they air.'
        : mode === 'future'
          ? 'Kestrel grabs new episodes as they air and leaves the ones that aired before.'
          : 'Kestrel keeps the files and searches nothing.'
    const specials = (episodes ?? []).filter((e) => e.season === 0 && !e.monitored).length
    if (mode !== 'none' && specials > 0) text += ` ${specials} ${specials === 1 ? 'Special is' : 'Specials are'} not monitored.`
  }
  return <p className="copy-13 text-gray-900">{text}</p>
}
