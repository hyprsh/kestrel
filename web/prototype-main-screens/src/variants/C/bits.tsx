// PROTOTYPE, throwaway. Variant C helpers: dates, list keyboard navigation, small dense widgets.
import { useEffect, type ReactNode } from 'react'
import { SLOTS, TODAY, daysBetween, type Slot, type Title, type Version, type HistoryEvent } from '../../mock'
import { cx, Dot, versionStatus, type Tone } from '../../ui'

export const NOW = '2026-10-17 10:31'
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

const asDate = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00` : s.replace(' ', 'T'))
export const fmtDate = (s: string) => asDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDay = (s: string) => {
  const d = daysBetween(TODAY, s.slice(0, 10))
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return 'Yesterday'
  return asDate(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(s.slice(0, 4) !== TODAY.slice(0, 4) ? { year: 'numeric' } : {}) })
}
/** "09:13", "Yesterday 22:05", "Tue 14 Oct 12:00" */
export const fmtWhen = (at: string) => {
  const d = daysBetween(TODAY, at.slice(0, 10))
  return d === 0 ? at.slice(11) : `${fmtDay(at.slice(0, 10))} ${at.slice(11)}`
}
export const hoursAgo = (at: string) => (asDate(NOW).getTime() - asDate(at).getTime()) / 3600000
export const span = (days: number) => (days < 1 ? 'today' : days < 45 ? `${days} days` : days < 540 ? `${Math.round(days / 30.4)} months` : `${(days / 365).toFixed(1)} years`)
export const ago = (date?: string) => {
  if (!date) return 'never'
  const d = daysBetween(date.slice(0, 10), TODAY)
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} d ago`
}

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement
  return !!t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey
}

/** j/k + ↑/↓ move, Enter opens. Ignored while typing or while the command menu is open. */
export function useListNav(scope: string, count: number, sel: number, setSel: (i: number) => void, onEnter?: (i: number) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || document.querySelector('[data-cmdk]')) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSel(Math.min(count - 1, sel + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSel(Math.max(0, sel - 1))
      } else if (e.key === 'Enter' && onEnter && sel >= 0 && !(e.target as HTMLElement).closest('button, a')) {
        e.preventDefault()
        onEnter(sel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    document.querySelector(`[data-nav="${scope}-${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [scope, sel])
}

/** Single-key shortcut (e.g. "/" to focus a filter), ignored while typing. */
export function useKey(key: string, fn: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || document.querySelector('[data-cmdk]')) return
      if (key !== 'Escape' && typing(e)) return
      fn(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

export const sortVersions = (vs: Version[]) => [...vs].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))

/** Three tiny dots, SD · HD · UHD; hollow when the Slot has no Version. */
export function SlotDots({ t, only }: { t: Title; only?: Slot[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {(only ?? SLOTS).map((s) => {
        const v = t.versions.find((x) => x.slot === s)
        if (!v) return <span key={s} title={`${s}: no Version`} className="inline-block size-2 rounded-full border border-gray-500" />
        const st = versionStatus(v)
        return (
          <span key={s} title={`${s}: ${st.label}`} className="inline-flex">
            <Dot tone={st.tone} />
          </span>
        )
      })}
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'xs' | 'sm' }) {
  return (
    <div className="inline-flex rounded-md border border-gray-alpha-400 bg-background-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[5px] px-2.5 font-medium whitespace-nowrap transition-colors',
            size === 'xs' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
            value === o.value ? 'bg-background-100 text-gray-1000 shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-gray-alpha-400' : 'text-gray-900 hover:text-gray-1000',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: Tone }) {
  const pct = Math.min(100, (value / max) * 100)
  const t = tone ?? (pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green')
  const c = { green: 'bg-green-700', amber: 'bg-amber-700', red: 'bg-red-700', blue: 'bg-blue-700', gray: 'bg-gray-600' }[t as 'green'] ?? 'bg-gray-600'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-alpha-200">
      <div className={cx('h-full rounded-full', c)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function MiniToggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
      className={cx('relative h-3.5 w-6 shrink-0 rounded-full transition-colors', on ? 'bg-blue-700' : 'bg-gray-500')}
    >
      <span className={cx('absolute top-0.5 size-2.5 rounded-full bg-white transition-all', on ? 'left-[12px]' : 'left-0.5')} />
    </button>
  )
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--ds-gray-1000)]" />
      {label}
    </label>
  )
}

export const eventTone: Record<HistoryEvent['type'], Tone> = {
  Grabbed: 'blue',
  Imported: 'green',
  Upgraded: 'purple',
  Failed: 'red',
  Blocklisted: 'red',
  Renamed: 'gray',
  Requested: 'teal',
  'Version added': 'gray',
  Adopted: 'teal',
}

export function SectionHead({ title, count, tone = 'gray', right }: { title: ReactNode; count?: number; tone?: Tone; right?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 px-1">
      <h2 className="text-[13px] font-semibold tracking-tight text-gray-1000">{title}</h2>
      {count !== undefined && (
        <span className={cx('rounded-full px-1.5 font-mono text-[11px] tabular', count > 0 && tone !== 'gray' ? { red: 'bg-red-200 text-red-900', amber: 'bg-amber-200 text-amber-900', blue: 'bg-blue-200 text-blue-900', green: 'bg-green-200 text-green-900' }[tone as 'red'] : 'bg-gray-alpha-200 text-gray-900')}>
          {count}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 text-[12px] text-gray-900">{right}</div>
    </div>
  )
}

export function LinkButton({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex items-center gap-1 text-[12px] text-gray-900 hover:text-gray-1000 hover:underline underline-offset-2', className)}>
      {children}
    </button>
  )
}

/** Page wrapper for scrolling screens. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-auto">
      <div className={cx('mx-auto px-6 py-6 pb-24', wide ? 'max-w-6xl' : 'max-w-4xl')}>{children}</div>
    </div>
  )
}
