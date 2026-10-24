import { type ReactElement } from 'react'
import type { components } from '../api/schema.gen'
import { Popover, Snippet } from '@hyprsh/design'
import { size } from './bits'

type EpisodeCell = components['schemas']['EpisodeCell']
type EpisodeFile = components['schemas']['EpisodeFile']

/** Size, quality and Score of a cell's file, joined for a line of text. */
function facts(cell: EpisodeCell | null): string[] {
  const out: string[] = []
  if (cell?.score != null) out.push(`Score ${cell.score}`)
  if (cell?.file?.quality) out.push(cell.file.quality)
  if (cell?.file) out.push(size(cell.file.size))
  return out
}

/** The hover tooltip of an episode cell: its state, then the file's facts and path. */
export function cellTitle(slot: string, state: string, cell: EpisodeCell | null): string {
  const head = [`${slot}: ${state}`, ...facts(cell)].join(' · ')
  return cell?.file ? `${head}\n${cell.file.path}` : head
}

/**
 * The popover a click on a file's name or an episode cell opens: the path in a Snippet (its copy button
 * tells the user to copy by hand when the clipboard fails), a line of what else the file holds, and for a Movie's file the release it was
 * grabbed as. `trigger` is the element that opens it. Keys pressed in it stay out of the grid or
 * the pane, apart from the Escape and Tab the popover handles itself.
 */
export function FilePopover({
  label,
  path,
  note,
  grabbedAs,
  trigger,
  position = 'bottom-end',
}: {
  label: string
  path: string
  note?: string
  grabbedAs?: string
  trigger: ReactElement
  position?: 'bottom-start' | 'bottom-end'
}) {
  return (
    <Popover trigger={trigger} label={label} position={position} width={320}>
      <div
        // The grid's arrows and Space, and the detail's Escape, must not fire; the popover keeps Escape and Tab.
        onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}
        className="flex flex-col gap-2"
      >
        <Snippet prompt={false} text={path} width="100%" />
        {note && <p className="label-12 text-gray-900">{note}</p>}
        {grabbedAs && <p className="label-12 break-all text-gray-900">Grabbed as {grabbedAs}</p>}
      </div>
    </Popover>
  )
}

/** The popover of a filled episode cell: its file's path and facts. `trigger` is the cell itself. */
export function EpisodeFilePopover({ label, cell, file, trigger }: { label: string; cell: EpisodeCell; file: EpisodeFile; trigger: ReactElement }) {
  const others = file.episode_ids.length
  return <FilePopover label={`${label} file`} path={file.path} note={[...facts(cell), ...(others > 1 ? [`This file holds ${others} episodes`] : [])].join(' · ')} trigger={trigger} />
}

/** The popover of a cell with no file, for touch where its hover title is out of reach: what its colour says. */
export function CellPopover({ label, text, trigger }: { label: string; text: string; trigger: ReactElement }) {
  return (
    <Popover trigger={trigger} label={`${label} state`} position="bottom-end" width={240}>
      <p className="label-13 text-gray-1000">{text}</p>
    </Popover>
  )
}
