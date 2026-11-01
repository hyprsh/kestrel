import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import type { components } from '../api/schema.gen'
import { Badge, Button, Popover, StatusDot } from '@hyprsh/design'
import { cx } from '../ui'
import { dotOf, size, type Dot } from './bits'
import type { CellLike } from './cellDetail'

type EpisodeCell = components['schemas']['EpisodeCell']
type EpisodeFile = components['schemas']['EpisodeFile']
type CustomFormat = components['schemas']['CustomFormatMatch']

/** Size, quality and Score of a cell's file, joined for a line of text. */
function facts(cell: CellLike | null): string[] {
  const out: string[] = []
  if (cell?.score != null) out.push(`Score ${cell.score}`)
  if (cell?.file?.quality) out.push(cell.file.quality)
  if (cell?.file) out.push(size(cell.file.size))
  return out
}

/** The hover tooltip of an episode cell: its state, then the file's facts and path. */
export function cellTitle(slot: string, state: string, cell: CellLike | null): string {
  const head = [`${slot}: ${state}`, ...facts(cell)].join(' · ')
  return cell?.file ? `${head}\n${cell.file.path}` : head
}

/** What the popover knows of a file; the fields an Episode's file and a Movie's FileSummary share. */
type FileFacts = {
  path: string
  release_name?: string
  quality?: string | null
  languages?: string[]
  size: number
  imported_at?: string
  release_group?: string | null
  score?: number | null
  custom_formats?: CustomFormat[]
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : '0')

/** "Oct 20" for a date this year, "Oct 20, 2024" for another; "" for an unreadable one. */
function importedOn(iso: string | undefined): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

/** Copies text, trying the Clipboard API first and a hidden textarea after it; resolves whether it worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    return ok
  }
}

/** A path on one line that gives up its start, not its end: "\u2026/Season 05/Breaking Bad - S05E01.mkv". The full path is its tooltip. */
export function EndOfPath({ path, className }: { path: string; className?: string }) {
  // The right-to-left box clips and ellipsises at the start; <bdi> keeps the slashes and dots of the path in reading order.
  return (
    <span dir="rtl" title={path} className={cx('label-12-mono block min-w-0 truncate text-left text-gray-900', className)}>
      <bdi>{path}</bdi>
    </span>
  )
}

/**
 * The popover of a file: a header with a status dot and `heading`, the release name in mono, a grid of what is known of it
 * (Quality, Audio, Size, Imported, Score), the Custom Formats it matched with their points, the path (its start cut off,
 * the file name kept), and the buttons: Upgrade Search when `onUpgrade` is given, and Copy Path. A row the data lacks is
 * left out, never guessed. Keys pressed in it stay out of the grid or the pane, apart from the Escape and Tab the popover
 * handles itself.
 */
export function FileDetailsPopover({
  label,
  heading,
  dot,
  file,
  note,
  trigger,
  onUpgrade,
  position = 'bottom-end',
}: {
  label: string
  heading: string
  dot: Dot
  file: FileFacts
  note?: string
  trigger: ReactElement
  onUpgrade?: () => void
  position?: 'bottom-start' | 'bottom-end'
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copyPath = () => {
    void copyText(file.path).then((ok) => {
      setCopy(ok ? 'copied' : 'failed')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopy('idle'), 2000)
    })
  }
  const on = importedOn(file.imported_at)
  const rows: [string, string][] = []
  if (file.quality) rows.push(['Quality', file.quality])
  if (file.languages?.length) rows.push(['Audio', file.languages.join(', ')])
  rows.push(['Size', size(file.size)])
  if (on) rows.push(['Imported', file.release_group ? `${on}, from ${file.release_group}` : on])
  else if (file.release_group) rows.push(['Group', file.release_group])
  const formats = file.custom_formats ?? []
  return (
    <Popover trigger={trigger} label={label} position={position} width={340}>
      {({ close }) => (
        <div
          // The grid's arrows and Space, and the detail's Escape, must not fire; the popover keeps Escape and Tab.
          onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}
          className="flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-2">
            <StatusDot state={dot.state} variant={dot.variant} label={false} title={null} aria-hidden />
            <p className="label-14-strong">{heading}</p>
          </div>
          {file.release_name && <p className="label-12-mono break-all text-gray-900">{file.release_name}</p>}
          <dl className="label-13 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-y-1">
            {rows.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-gray-900">{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
            {file.score != null && (
              <>
                <dt className="text-gray-900">Score</dt>
                <dd>
                  <span className="hy-num">{file.score.toLocaleString('en-US')}</span>
                  {formats.length > 0 && (
                    <ul className="mt-1 flex list-none flex-wrap gap-1 p-0" aria-label="Custom Formats">
                      {formats.map((f) => (
                        <li key={f.name} title={`${f.name}: ${f.points} points`}>
                          <Badge variant="gray" contrast="low" size="sm">
                            {f.name} {signed(f.points)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </>
            )}
          </dl>
          {note && <p className="label-12 text-gray-900">{note}</p>}
          <EndOfPath path={file.path} />
          <div className="flex gap-2">
            {onUpgrade && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  close()
                  onUpgrade()
                }}
              >
                Upgrade Search
              </Button>
            )}
            <Button variant="tertiary" size="small" onClick={copyPath}>
              {copy === 'copied' ? 'Copied' : 'Copy Path'}
            </Button>
          </div>
          <span className="hy-sr" aria-live="polite">
            {copy === 'copied' ? 'Copied to clipboard' : copy === 'failed' ? 'Copy failed. Select the path and copy it manually.' : ''}
          </span>
          {copy === 'failed' && <p className="label-12 text-red-900">Copy failed. Select the path and copy it manually.</p>}
        </div>
      )}
    </Popover>
  )
}

/**
 * The popover of a filled episode cell: `heading` names the cell ("S05E01 \u00b7 Standard"), the cell's state is its dot, and
 * Upgrade Search opens Manual search on this Slot where a better Release can be picked.
 */
export function EpisodeFilePopover({
  label,
  heading,
  cell,
  file,
  trigger,
  onUpgrade,
}: {
  label: string
  heading: string
  cell: EpisodeCell
  file: EpisodeFile
  trigger: ReactElement
  onUpgrade?: () => void
}) {
  const others = file.episode_ids.length
  return (
    <FileDetailsPopover
      label={`${label} file`}
      heading={heading}
      dot={dotOf(cell.state, false)}
      file={{ ...file, score: cell.score }}
      note={others > 1 ? `This file holds ${others} episodes` : undefined}
      trigger={trigger}
      onUpgrade={onUpgrade}
    />
  )
}

/** The popover of a cell with no file, for touch where its hover title is out of reach: what its colour says. */
export function CellPopover({ label, text, trigger }: { label: string; text: string; trigger: ReactElement }) {
  return (
    <Popover trigger={trigger} label={`${label} state`} position="bottom-end" width={240}>
      <p className="label-13 text-gray-1000">{text}</p>
    </Popover>
  )
}
