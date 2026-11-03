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
import { useSlotNames } from './slots'
import { useTitleDownloads } from './TitleDownloads'
import { useSetMovieMonitored, useSetSeriesMonitor, useSetSeriesMonitorOptions } from '../api/titleActions'
import { useReport } from '../toasts'

const on = { background: 'var(--green-100)', color: 'var(--green-900)', boxShadow: 'inset 0 0 0 1px var(--green-400)' }
const off = { background: 'var(--background-100)', color: 'var(--gray-900)', boxShadow: 'inset 0 0 0 1px var(--gray-alpha-400)' }

/** A switch item says its state with its Toggle: the menu's own check mark (still the item's `checked` for a screen reader) is hidden (kept as a gap, so the labels line up with the modes above). */
const noCheck = '[&_.hy-glyph]:invisible!'

/** The choices of a Series' mode: the words of the menu, the button's tail and the line under the title. */
const seriesModes: { value: SeriesMonitor; label: string; description: string; tail: string }[] = [
  { value: 'all', label: 'All episodes', description: 'Search the past ones that are missing, and new ones', tail: 'all episodes' },
  { value: 'future', label: 'Future episodes only', description: 'Leave what aired before; grab what airs from now', tail: 'future episodes' },
  { value: 'none', label: 'Not monitored', description: 'Keep the files, search nothing', tail: '' },
]

/**
 * Whether a Title is monitored, as the server says: a Movie's flag, a Series' mode not being Not monitored or any of its seasons
 * or episodes being monitored. A Series in mode Not monitored that still has a monitored episode is monitored: that episode is
 * searched for when it airs. Choosing Not monitored in the menu again unmonitors every episode.
 */
export const isMonitored = (title: Pick<TitleDetail, 'monitored'>) => title.monitored

// chrome-ok: the monitored/unmonitored bookmark glyph, not the design Icon wrapper
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
  if (!tail) return 'Monitored'
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
        aria-label={`Monitoring: ${monitored ? ['monitored', seriesModes.find((m) => m.value === mode)?.tail].filter(Boolean).join(', ') : 'not monitored'}`}
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
          className={noCheck}
          disabled={!monitored}
          description={monitored ? 'Seasons added later start monitored' : 'Applies when monitored'}
          suffix={<Toggle size="small" checked={newSeasons} disabled={!monitored} aria-hidden tabIndex={-1} onChange={() => undefined} />}
          onSelect={() => flag({ monitor_new_seasons: !newSeasons })}
        >
          Monitor New Seasons
        </MenuItem>
        <MenuItem
          role="checkbox"
          checked={specials}
          className={noCheck}
          disabled={!monitored}
          description={monitored ? 'Season 0 follows the mode above' : 'Applies when monitored'}
          suffix={<Toggle size="small" checked={specials} disabled={!monitored} aria-hidden tabIndex={-1} onChange={() => undefined} />}
          onSelect={() => flag({ monitor_specials: !specials })}
        >
          Monitor Specials
        </MenuItem>
      </Menu>
    </Menu.Container>
  )
}

/** What monitoring does, in a sentence: "Kestrel searches every Wanted episode and grabs new ones as they air. 4 Specials are not monitored." It is the monitoring chip's popover. */
export function useMonitoringText(title: TitleDetail): string {
  const episodes = useEpisodes(title.id, title.kind === 'series').data
  const downloads = useTitleDownloads(title.id)
  const slots = useSlotNames()
  let text: string
  if (title.kind === 'movie') {
    if (!title.monitored) {
      const files = title.versions.filter((v) => v.file)
      const running = title.versions.flatMap((v) => (downloads.slot(v.slot) ? [{ slot: v.slot, pct: downloads.slot(v.slot)?.pct ?? null }] : []))
      const idle = title.versions.filter((v) => !v.file && !downloads.slot(v.slot)).map((v) => slots.name(v.slot))
      const parts: string[] = []
      if (running.length > 0) {
        const what = running.map((d) => `${slots.name(d.slot)} download${d.pct !== null ? ` (${d.pct}%)` : ''}`).join(' and ')
        parts.push(`The ${what} still ${running.length > 1 ? 'finish' : 'finishes'}; Kestrel searches nothing else.`)
      } else {
        parts.push(files.length > 0 ? 'Kestrel keeps its file and searches nothing.' : 'Kestrel searches nothing.')
      }
      if (running.length > 0 && files.length > 0) parts.push('It keeps its file.')
      if (idle.length > 0) parts.push(`Its ${idle.join(' and ')} ${plural(idle.length, 'Version').replace(/^\d+ /, '')} would be Wanted once monitored.`)
      text = parts.join(' ')
    } else {
      const wanted = title.versions.filter((v) => v.state === 'wanted').map((v) => slots.name(v.slot))
      text =
        wanted.length > 0
          ? `Kestrel searches the Wanted ${wanted.join(' and ')} ${plural(wanted.length, 'Version').replace(/^\d+ /, '')} and grabs Upgrades until the Cutoff.`
          : 'Kestrel grabs Upgrades until the Cutoff.'
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
  return text
}
