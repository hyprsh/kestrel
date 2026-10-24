// chrome: waiting hyprsh/design#36
import type { ReactNode } from 'react'
import { cx } from './ui'

/**
 * A list row the j/k selection (`useListNav`) can land on: `scope-index` is what the
 * hook scrolls into view, and the selected row is the one with aria-current.
 * Waits for Entity `current`, which replaces it.
 */
export function NavRow({ scope, index, sel, onSelect, className, children }: { scope: string; index: number; sel: number; onSelect: () => void; className?: string; children: ReactNode }) {
  return (
    <li
      data-nav={`${scope}-${index}`}
      aria-current={index === sel ? 'true' : undefined}
      onClick={onSelect}
      className={cx('cursor-pointer', index === sel ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100', className)}
    >
      {children}
    </li>
  )
}
