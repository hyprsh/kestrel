import { useRef, useState, type ReactElement } from 'react'
import type { components } from '../api/schema.gen'
import { Button, Popover } from '@hyprsh/design'
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
 * The popover a click or tap on a filled episode cell opens: the file's path, selectable and with
 * a Copy button, and what else the file holds. `trigger` is the cell itself. Keys pressed in it
 * stay out of the grid, apart from the Escape and Tab the popover handles itself.
 */
export function EpisodeFilePopover({ label, cell, file, trigger }: { label: string; cell: EpisodeCell; file: EpisodeFile; trigger: ReactElement }) {
  const pathRef = useRef<HTMLParagraphElement>(null)
  const [copied, setCopied] = useState<'copied' | 'selected' | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.path)
      setCopied('copied')
    } catch {
      // No clipboard outside a secure context: select the path for a manual copy instead.
      const sel = window.getSelection()
      if (sel && pathRef.current) {
        sel.selectAllChildren(pathRef.current)
        setCopied('selected')
      }
    }
  }

  const others = file.episode_ids.length
  return (
    <Popover trigger={trigger} label={`${label} file`} position="bottom-end" width={320}>
      <div
        // The grid's arrows and Space, and the detail's Escape, must not fire; the popover keeps Escape and Tab.
        onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}
        className="flex flex-col gap-2 p-3 text-left"
      >
        <p ref={pathRef} className="label-12-mono break-all text-gray-1000 select-text">
          {file.path}
        </p>
        <p className="label-12 text-gray-900">{[...facts(cell), ...(others > 1 ? [`This file holds ${others} episodes`] : [])].join(' · ')}</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="small" onClick={() => void copy()}>
            {copied === 'copied' ? 'Copied' : 'Copy path'}
          </Button>
          {copied === 'selected' && <span className="label-12 text-gray-900">Path selected: copy it with your keyboard.</span>}
        </div>
      </div>
    </Popover>
  )
}
