import { useEffect, useRef, useState } from 'react'
import type { components } from '../api/schema.gen'
import { Button } from '@hyprsh/design'
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
 * The popover a click or tap on a filled episode cell opens: the file's path,
 * selectable and with a Copy button, and what else the file holds. Escape or a
 * click outside its cell closes it; keys pressed in it stay out of the grid.
 */
export function EpisodeFileTip({ label, cell, file, onClose }: { label: string; cell: EpisodeCell; file: EpisodeFile; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pathRef = useRef<HTMLParagraphElement>(null)
  const [copied, setCopied] = useState<'copied' | 'selected' | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // The cell's own click toggles the popover, so only clicks beyond its grid cell close it here.
      const cellEl = ref.current?.parentElement
      if (cellEl && e.target instanceof Node && !cellEl.contains(e.target)) close.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

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
    <div
      ref={ref}
      role="dialog"
      aria-label={`${label} file`}
      onKeyDown={(e) => {
        e.stopPropagation() // the grid's arrows and Space, and the detail's Escape, must not fire
        if (e.key === 'Escape') {
          e.preventDefault()
          ref.current?.parentElement?.querySelector<HTMLElement>('[data-cell]')?.focus()
          onClose()
        }
      }}
      className="absolute top-full right-0 z-20 mt-1 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-gray-alpha-400 bg-background-100 p-3 text-left shadow-lg"
    >
      <p ref={pathRef} className="label-12-mono break-all text-gray-1000 select-text">
        {file.path}
      </p>
      <p className="label-12 text-gray-900">
        {[...facts(cell), ...(others > 1 ? [`This file holds ${others} episodes`] : [])].join(' · ')}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="small" autoFocus onClick={() => void copy()}>
          {copied === 'copied' ? 'Copied' : 'Copy path'}
        </Button>
        {copied === 'selected' && <span className="label-12 text-gray-900">Path selected: copy it with your keyboard.</span>}
      </div>
    </div>
  )
}
