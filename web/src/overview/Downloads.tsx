// The Downloading card on the Overview: one row per live Grab, with its poster, the Title (and episode or Slot), a slim
// Progress bar and "12% · 22 min". The release name and byte counts are on Activity's Grabs tab; Cancel is in the row's menu.
// Its rows are part of the Overview's one j/k selection.
import { DotsMenu, MenuItem, Progress } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { phases } from '../grabs/phase'
import { NowCard, NowEmpty, NowList, NowRow } from '../layout/NowCard'
import { SkeletonRows } from '../loading'
import { SlotTag } from '../library/SlotPills'
import { TitlePoster } from '../poster'
import { cx } from '../ui'
import { useOpenPlace } from '../place'
import { span } from '../time'
import type { OverviewNav } from './nav'
import { speedText } from './statsText'

/** "12% · 22 min" while downloading; the state otherwise ("Queued", "Importing"). An importing Grab is full and warns. */
function progressLine(i: QueueItem): { pct: number | null; text: string; importing: boolean } {
  const importing = i.phase === 'importing'
  const pct = importing ? 100 : percent(i.bytes_total, i.bytes_left)
  if (i.phase !== 'downloading') return { pct, text: phases[i.phase].label, importing }
  return { pct, importing, text: [pct !== null && `${pct}%`, i.eta != null && span(i.eta * 1000)].filter(Boolean).join(' · ') || phases.downloading.label }
}

/** The client's total speed now: what the live Grabs add up to, null when no Grab reports one. */
function totalSpeed(items: QueueItem[]): number | null {
  const speeds = items.flatMap((i) => (i.bytes_per_second ? [i.bytes_per_second] : []))
  return speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) : null
}

export function DownloadingCard({
  items,
  all,
  firstIndex,
  nav,
  loaded,
  busy,
  onCancel,
  onOpenTitle,
}: {
  /** The rows shown, and `all` every live Grab for the count and the speed. */
  items: QueueItem[]
  all: QueueItem[]
  /** The first row's place in the j/k list. */
  firstIndex: number
  nav: OverviewNav
  loaded: boolean
  busy: boolean
  onCancel: (grabId: number, blocklist: boolean) => void
  onOpenTitle: (id: number) => void
}) {
  const openPlace = useOpenPlace()
  const speed = totalSpeed(all)
  return (
    <NowCard label="Downloading" count={all.length} aside={speed !== null && speedText(speed)} footer={{ label: 'All activity', onOpen: () => openPlace('/activity') }}>
      {!loaded ? (
        <SkeletonRows count={3} poster="xs" />
      ) : items.length === 0 ? (
        <NowEmpty>Nothing downloading</NowEmpty>
      ) : (
        <NowList>
          {items.map((g, n) => {
            const index = firstIndex + n
            const { pct, text, importing } = progressLine(g)
            const name = g.title || 'Deleted Title'
            return (
              <NowRow
                key={g.grab_id}
                navIndex={index}
                current={index === nav.sel}
                onSelect={() => nav.select(index)}
                onOpen={() => g.title_id != null && onOpenTitle(g.title_id)}
                lead={g.title_id != null ? <TitlePoster id={g.title_id} hasPoster={g.has_poster} size="xs" /> : undefined}
                right={
                  <span className="flex items-center gap-2">
                    {g.slot && <SlotTag slot={g.slot} state={g.is_upgrade ? 'filled' : 'downloading'} text={pct !== null ? `${pct}%` : undefined} />}
                    <DotsMenu aria-label={`Actions for ${name}`} disabled={busy}>
                      <MenuItem onClick={() => onCancel(g.grab_id, false)}>Cancel</MenuItem>
                      <MenuItem onClick={() => onCancel(g.grab_id, true)}>Cancel and blocklist</MenuItem>
                    </DotsMenu>
                  </span>
                }
              >
                <span className="label-14 min-w-0 truncate">
                  <b className="font-medium">{name}</b> <span className="text-gray-900">{g.episodes.join(', ')}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  {pct !== null && <Progress value={pct} type={importing ? 'warning' : 'success'} height={4} aria-label={`${name} progress`} className="min-w-0 flex-1" />}
                  <span className={cx('label-12 shrink-0 text-right tabular-nums', importing ? 'text-amber-900' : 'text-gray-900')}>{text}</span>
                </span>
              </NowRow>
            )
          })}
        </NowList>
      )}
    </NowCard>
  )
}
