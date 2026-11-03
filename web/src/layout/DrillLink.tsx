// chrome: layout
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'

/**
 * A figure or a line of a card that opens the screen holding the data behind it, at the place `to` (see place.ts): a bare
 * button, so it works by keyboard, that underlines on hover and takes the focus ring. `label` is its accessible name and
 * names where it leads. The children keep their own type: they are text in the tile's or card's own classes.
 */
export function DrillLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  const openPlace = useOpenPlace()
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => openPlace(to)}
      className="m-0 min-w-0 cursor-pointer self-start rounded-xs border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
    >
      {children}
    </button>
  )
}
