// A poster shelf: one row of 2:3 Title posters with a name and a short line under each. It shows as
// many as fit its width, up to `max`, and never scrolls sideways: the Overview's j/k list is built from
// the same count (`useShelfCount`), so the selection runs through exactly the posters on screen.
import { Entity } from '@hyprsh/design'
import { useLayoutEffect, useState } from 'react'
import { TitlePoster } from '../poster'
import type { OverviewNav } from './nav'

/** Posters per shelf on a desktop. */
export const SHELF_MAX = 8

// A cell is the xl poster (96px) with room for its Entity padding; the gap is Tailwind's gap-2.
const CELL = 112
const GAP = 8

/** How many cells fit `width`: at least one, at most `max`. */
export const fitCells = (width: number, max = SHELF_MAX) => Math.max(1, Math.min(max, Math.floor((width + GAP) / (CELL + GAP))))

/**
 * The element to measure (pass `ref` to the Shelf) and how many posters fit it. Before it is measured, or
 * where there is no ResizeObserver, that is `max`.
 */
export function useShelfCount(max = SHELF_MAX) {
  const [el, ref] = useState<HTMLElement | null>(null)
  const [count, setCount] = useState(max)
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setCount(fitCells(entries[0].contentRect.width, max)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, max])
  return { ref, count }
}

export type ShelfItem = {
  key: string
  titleId: number
  hasPoster: boolean
  name: string
  /** Slot and age, or episode and day. */
  line: string
}

/** `items` are the ones that fit (the caller cuts them to `useShelfCount`); `nav.base` is the first one's place in the j/k list. */
export function Shelf({ items, nav, shelf, onOpen }: { items: ShelfItem[]; nav: OverviewNav; shelf: ReturnType<typeof useShelfCount>; onOpen: (id: number) => void }) {
  return (
    <ul ref={shelf.ref} className="flex gap-2 overflow-hidden">
      {items.map((item, j) => {
        const i = nav.base + j
        return (
          <li key={item.key} className="w-28 shrink-0">
            <Entity
              as="button"
              current={i === nav.sel}
              data-nav={`ov-${i}`}
              onClick={() => {
                nav.select(i)
                onOpen(item.titleId)
              }}
              className="w-full"
              leftClassName="flex-col items-start gap-1.5"
              left={<TitlePoster id={item.titleId} hasPoster={item.hasPoster} size="xl" />}
            >
              <Entity.Content className="w-full" title={<span className="block truncate">{item.name}</span>} description={<span className="block truncate">{item.line}</span>} />
            </Entity>
          </li>
        )
      })}
    </ul>
  )
}
