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

export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'

const tones: Record<Tone, string> = {
  gray: 'bg-gray-alpha-200 text-gray-900',
  blue: 'bg-blue-200 text-blue-900',
  green: 'bg-green-200 text-green-900',
  amber: 'bg-amber-200 text-amber-900',
  red: 'bg-red-200 text-red-900',
  purple: 'bg-purple-100 text-purple-900',
  teal: 'bg-teal-100 text-teal-900',
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  )
}

export function KestrelLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-label="Kestrel">
      <path d="M2 17 L12 4 L22 17 L15 13 L12 20 L9 13 Z" />
    </svg>
  )
}
