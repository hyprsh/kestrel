// PROTOTYPE, throwaway. Small Geist-style primitives shared by all variants (buttons, badges, inputs, poster placeholder).
// Layout is NOT shared: every variant builds its own shell and screens.
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import type { Slot, Version } from './mock'
import { isLongMissing, profileById } from './mock'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> & { variant?: 'primary' | 'secondary' | 'tertiary' | 'error'; size?: 'sm' | 'md' | 'lg'; prefix?: ReactNode }
export function Button({ variant = 'secondary', size = 'md', prefix, className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
        size === 'sm' && 'h-8 px-2.5 text-[13px]',
        size === 'md' && 'h-9 px-3 text-sm',
        size === 'lg' && 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-gray-1000 text-background-100 hover:opacity-90',
        variant === 'secondary' && 'bg-background-100 text-gray-1000 border border-gray-alpha-400 hover:bg-gray-alpha-100 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        variant === 'tertiary' && 'text-gray-1000 hover:bg-gray-alpha-200',
        variant === 'error' && 'bg-red-700 text-white hover:bg-red-900',
        className,
      )}
    >
      {prefix}
      {children}
    </button>
  )
}

export function Input({ className, prefix, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { prefix?: ReactNode }) {
  return (
    <label className={cx('flex h-9 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-100 px-3 text-sm focus-within:ring-2 focus-within:ring-gray-alpha-400 focus-within:border-gray-600', className)}>
      {prefix && <span className="text-gray-900">{prefix}</span>}
      <input {...rest} className="w-full bg-transparent outline-none placeholder:text-gray-700" />
    </label>
  )
}

const badgeTones = {
  gray: 'bg-gray-200 text-gray-1000',
  blue: 'bg-blue-200 text-blue-900',
  green: 'bg-green-200 text-green-900',
  amber: 'bg-amber-200 text-amber-900',
  red: 'bg-red-200 text-red-900',
  purple: 'bg-purple-100 text-purple-900',
  teal: 'bg-teal-100 text-teal-900',
  inverted: 'bg-gray-1000 text-background-100',
}
export type Tone = keyof typeof badgeTones
export function Badge({ tone = 'gray', children, className, mono }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return <span className={cx('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap', mono && 'font-mono', badgeTones[tone], className)}>{children}</span>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-alpha-400 bg-background-200 px-1 font-mono text-[11px] text-gray-900">{children}</kbd>
}

export function Dot({ tone }: { tone: Tone }) {
  const c = { gray: 'bg-gray-600', blue: 'bg-blue-700', green: 'bg-green-700', amber: 'bg-amber-700', red: 'bg-red-700', purple: 'bg-purple-700', teal: 'bg-teal-700', inverted: 'bg-gray-1000' }[tone]
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', c)} />
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange?: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button type="button" onClick={() => onChange?.(!on)} className={cx('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-blue-700' : 'bg-gray-500')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  )
}

export function Select({ value, options, onChange, className }: { value: string; options: string[]; onChange?: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange?.(e.target.value)} className={cx('h-9 rounded-md border border-gray-alpha-400 bg-background-100 px-2.5 text-sm outline-none', className)}>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
}

/** Placeholder poster: TMDB posters only (no backdrops/stills), drawn as a gradient with the title. */
export function Poster({ title, hue, className, small }: { title: string; hue: number; className?: string; small?: boolean }) {
  return (
    <div
      className={cx('relative overflow-hidden rounded-md aspect-[2/3] shrink-0 border border-gray-alpha-200', className)}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 14%))` }}
    >
      {!small && <span className="absolute inset-x-0 bottom-0 p-2 text-[11px] font-semibold leading-tight text-white/90">{title}</span>}
    </div>
  )
}

/** Status of one Version, as shown everywhere. */
export function versionStatus(v: Version): { tone: Tone; label: string } {
  if (v.state === 'available') {
    if (v.episodesWanted !== undefined && v.episodesHave! < v.episodesWanted) return { tone: 'amber', label: `${v.episodesHave}/${v.episodesWanted}` }
    return { tone: 'green', label: v.episodesWanted !== undefined ? `${v.episodesHave}/${v.episodesWanted}` : 'Available' }
  }
  if (v.state === 'downloading') return { tone: 'blue', label: `Downloading ${v.progress}%` }
  if (v.state === 'unreleased') return { tone: 'gray', label: 'Not released yet' }
  if (isLongMissing(v)) return { tone: 'red', label: v.episodesWanted !== undefined ? `Long missing · ${v.episodesHave}/${v.episodesWanted}` : 'Long missing' }
  return { tone: 'amber', label: v.episodesWanted !== undefined ? `Missing · ${v.episodesHave}/${v.episodesWanted}` : 'Missing' }
}

/** Compact Slot chip: "HD" with a status dot; hover shows Profile + status. */
export function SlotChip({ v, showProfile }: { v: Version; showProfile?: boolean }) {
  const s = versionStatus(v)
  const p = profileById(v.profileId)
  return (
    <span title={`${p.name} · ${s.label}`} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-gray-alpha-400 bg-background-100 px-1.5 font-mono text-[11px] font-medium">
      <Dot tone={s.tone} />
      {v.slot}
      {showProfile && p.name !== v.slot && <span className="font-sans font-normal text-gray-900">{p.name}</span>}
    </span>
  )
}

/** Empty Slot placeholder for "add a Version". */
export function EmptySlot({ slot, onClick }: { slot: Slot; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={`Add ${slot} Version`} className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-gray-500 px-1.5 font-mono text-[11px] text-gray-700 hover:text-gray-1000">
      + {slot}
    </button>
  )
}

export function KestrelLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-label="Kestrel">
      <path d="M2 17 L12 4 L22 17 L15 13 L12 20 L9 13 Z" />
    </svg>
  )
}

export const fmtNum = (n: number) => n.toLocaleString('de-DE').replace(/\./g, ' ')
