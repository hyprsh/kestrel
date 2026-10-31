// The download rows of "Happening now" on the Overview: one line per Grab, with its poster, the Title (and episode), a
// Progress bar and "64% · 6 min". The release name, byte counts and Slot are on Activity's Grabs tab;
// Cancel is in the row's menu. Its rows are part of the Overview's one j/k selection.
import { DotsMenu, Entity, MenuItem, Progress } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { phases } from '../grabs/phase'
import { TitlePoster } from '../poster'
import { span } from '../time'

/** "64% · 6 min" while downloading; the state otherwise ("Queued", "Importing"). */
function progressLine(i: QueueItem): { pct: number | null; text: string } {
  const pct = i.phase === 'importing' ? 100 : percent(i.bytes_total, i.bytes_left)
  if (i.phase !== 'downloading') return { pct, text: phases[i.phase].label }
  return { pct, text: [pct !== null && `${pct}%`, i.eta != null && span(i.eta * 1000)].filter(Boolean).join(' · ') || phases.downloading.label }
}

/** Rows for a list the caller draws (`RowList`), so they share its card with the rows before them. */
export function Downloads({
  items,
  firstIndex,
  sel,
  onSelect,
  busy,
  onCancel,
  onOpenTitle,
}: {
  items: QueueItem[]
  /** The first row's place in the j/k list. */
  firstIndex: number
  sel: number
  onSelect: (index: number) => void
  busy: boolean
  onCancel: (grabId: number, blocklist: boolean) => void
  onOpenTitle: (id: number) => void
}) {
  return (
    <>
      {items.map((g, n) => {
        const index = firstIndex + n
        const { pct, text } = progressLine(g)
        const name = g.title || 'Deleted Title'
        return (
          <Entity
            key={g.grab_id}
            as="button"
            current={index === sel}
            data-nav={`ov-${index}`}
            onClick={() => {
              onSelect(index)
              if (g.title_id != null) onOpenTitle(g.title_id)
            }}
            left={g.title_id != null ? <TitlePoster id={g.title_id} hasPoster={g.has_poster} size="sm" /> : undefined}
            right={
              <DotsMenu aria-label={`Actions for ${name}`} disabled={busy}>
                <MenuItem onClick={() => onCancel(g.grab_id, false)}>Cancel</MenuItem>
                <MenuItem onClick={() => onCancel(g.grab_id, true)}>Cancel and blocklist</MenuItem>
              </DotsMenu>
            }
          >
            <Entity.Content
              fill
              title={
                <>
                  <span className="font-medium">{name}</span>
                  {g.episodes.length > 0 && <span className="font-normal text-gray-900"> {g.episodes.join(', ')}</span>}
                </>
              }
              description={
                <span className="flex items-center gap-3">
                  {pct !== null && <Progress value={pct} type="success" height={6} aria-label={`${name} progress`} className="flex-1" />}
                  <span className="shrink-0 tabular-nums">{text}</span>
                </span>
              }
            />
          </Entity>
        )
      })}
    </>
  )
}
