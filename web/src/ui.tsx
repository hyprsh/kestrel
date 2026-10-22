// Small Geist-style primitives. Ported from the design prototype (wayfinder #13, variant C).
import type { ReactNode } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/**
 * A list row the j/k selection (`useListNav`) can land on: `scope-index` is what the
 * hook scrolls into view, and the selected row is the one with aria-current.
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

export function KestrelLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-label="Kestrel">
      <path d="M2 17 L12 4 L22 17 L15 13 L12 20 L9 13 Z" />
    </svg>
  )
}
