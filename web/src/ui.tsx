// Small Geist-style primitives. Ported from the design prototype (wayfinder #13, variant C).
import type { ReactNode } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-alpha-400 bg-background-200 px-1 font-mono text-[11px] text-gray-900">
      {children}
    </kbd>
  )
}

export function KestrelLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-label="Kestrel">
      <path d="M2 17 L12 4 L22 17 L15 13 L12 20 L9 13 Z" />
    </svg>
  )
}
