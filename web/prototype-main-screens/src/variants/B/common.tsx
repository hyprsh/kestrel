// PROTOTYPE, throwaway. Variant B · Posters: local store, overlays (sheet, dialog), small controls.
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { titles as mockTitles, TODAY, daysBetween, type Title, type Version, type Slot } from '../../mock'
import { Button as GeistButton, cx, versionStatus, type Tone } from '../../ui'

// ── Store: mutations only touch local React state ───────────────────────────

type Store = {
  titles: Title[]
  update: (id: string, fn: (t: Title) => Title) => void
  addTitle: (t: Title) => void
  toast: (msg: string) => void
}
const StoreCtx = createContext<Store | null>(null)
export const useStore = () => useContext(StoreCtx)!

export function StoreProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<Title[]>(() => structuredClone(mockTitles))
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([])
  const store: Store = {
    titles,
    update: (id, fn) => setTitles((ts) => ts.map((t) => (t.id === id ? fn(t) : t))),
    addTitle: (t) => setTitles((ts) => [t, ...ts]),
    toast: (msg) => {
      const id = Date.now() + Math.random()
      setToasts((ts) => [...ts, { id, msg }])
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3200)
    },
  }
  return (
    <StoreCtx.Provider value={store}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-16 z-[90] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto rounded-lg border border-gray-alpha-400 bg-background-100 px-4 py-3 text-sm shadow-lg transition-all duration-200 starting:translate-y-2 starting:opacity-0">
            {t.msg}
          </div>
        ))}
      </div>
    </StoreCtx.Provider>
  )
}

export const updateVersion = (t: Title, slot: Slot, fn: (v: Version) => Version): Title => ({ ...t, versions: t.versions.map((v) => (v.slot === slot ? fn(v) : v)) })

// ── Escape: one stack, the topmost overlay closes first ─────────────────────

const escStack: (() => void)[] = []
export function useEscapeRoot() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !escStack.length) return
      e.preventDefault()
      escStack[escStack.length - 1]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
export function useEscape(fn: () => void, active = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const h = () => ref.current()
    escStack.push(h)
    return () => {
      const i = escStack.lastIndexOf(h)
      if (i >= 0) escStack.splice(i, 1)
    }
  }, [active])
}

// ── Overlays ────────────────────────────────────────────────────────────────

export function Sheet({ onClose, width, z = 40, children, label }: { onClose: () => void; width: number; z?: number; children: ReactNode; label: string }) {
  useEscape(onClose)
  return createPortal(
    <div className="fixed inset-0 text-[14px] text-gray-1000" style={{ zIndex: z }} role="dialog" aria-label={label}>
      <div onClick={onClose} className="absolute inset-0 bg-black/40 transition-opacity duration-200 starting:opacity-0" />
      <div
        className="absolute inset-y-2 right-2 flex flex-col overflow-hidden rounded-xl border border-gray-alpha-400 bg-background-100 shadow-2xl transition-transform duration-300 ease-out starting:translate-x-12"
        style={{ width: `min(${width}px, calc(100vw - 16px))` }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Dialog({ onClose, width = 480, z = 60, top, children, label }: { onClose: () => void; width?: number; z?: number; top?: boolean; children: ReactNode; label: string }) {
  useEscape(onClose)
  return createPortal(
    <div className={cx('fixed inset-0 flex justify-center px-4 text-[14px] text-gray-1000', top ? 'items-start pt-[12vh]' : 'items-center')} style={{ zIndex: z }} role="dialog" aria-label={label}>
      <div onClick={onClose} className="absolute inset-0 bg-black/40 transition-opacity duration-150 starting:opacity-0" />
      <div className="relative flex max-h-[80vh] w-full flex-col overflow-hidden rounded-xl border border-gray-alpha-400 bg-background-100 shadow-2xl transition-all duration-200 starting:scale-[0.98] starting:opacity-0" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="inline-flex size-8 items-center justify-center rounded-md text-gray-900 hover:bg-gray-alpha-200 hover:text-gray-1000">
      <X size={16} />
    </button>
  )
}

/** Small popover menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEscape(() => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx('absolute top-full z-50 mt-1 min-w-48 rounded-lg border border-gray-alpha-400 bg-background-100 p-1 shadow-lg transition-all duration-100 starting:-translate-y-1 starting:opacity-0', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
export function MenuItem({ onClick, children, danger, icon, disabled, hint }: { onClick?: () => void; children: ReactNode; danger?: boolean; icon?: ReactNode; disabled?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-alpha-100 disabled:cursor-not-allowed disabled:opacity-50', danger ? 'text-red-900' : 'text-gray-1000')}
    >
      {icon}
      {children}
    </button>
  )
}

/** ui.tsx's Button types `prefix` as the HTML string attribute; this wrapper takes an icon and passes it as a child. */
export function Button({ prefix, children, ...rest }: Omit<ComponentProps<typeof GeistButton>, 'prefix'> & { prefix?: ReactNode }) {
  return (
    <GeistButton {...rest}>
      {prefix}
      {children}
    </GeistButton>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-md border border-gray-alpha-400 bg-background-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-3 text-[13px]',
            value === o.value ? 'bg-background-100 text-gray-1000 shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-gray-alpha-400' : 'text-gray-900 hover:text-gray-1000',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
        active ? 'border-transparent bg-gray-1000 text-background-100' : 'border-gray-alpha-400 bg-background-100 text-gray-900 hover:border-gray-500 hover:text-gray-1000',
      )}
    >
      {children}
      {count !== undefined && <span className={cx('tabular text-[11px]', active ? 'opacity-70' : 'text-gray-700')}>{count}</span>}
    </button>
  )
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-gray-1000" />
      {label}
    </label>
  )
}

/** Labelled form field. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-gray-900">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-gray-900">{hint}</span>}
    </div>
  )
}

/** Select whose options carry ids but show names. */
export function IdSelect({ value, options, onChange, className, disabled }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; className?: string; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cx('h-8 min-w-0 rounded-md border border-gray-alpha-400 bg-background-100 px-2 text-[13px] outline-none focus:ring-2 focus:ring-gray-alpha-400 disabled:opacity-50', className)}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function ProgressBar({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'green' | 'purple'; className?: string }) {
  const c = { blue: 'bg-blue-700', green: 'bg-green-700', purple: 'bg-purple-700' }[tone]
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-gray-alpha-200', className)}>
      <div className={cx('h-full rounded-full', c)} style={{ width: `${value}%` }} />
    </div>
  )
}

// ── Status tones and Slot pills ─────────────────────────────────────────────

export const toneSoft: Record<Tone, string> = {
  gray: 'bg-gray-200 text-gray-1000',
  blue: 'bg-blue-200 text-blue-900',
  green: 'bg-green-200 text-green-900',
  amber: 'bg-amber-200 text-amber-900',
  red: 'bg-red-200 text-red-900',
  purple: 'bg-purple-100 text-purple-900',
  teal: 'bg-teal-100 text-teal-900',
  inverted: 'bg-gray-1000 text-background-100',
}

/** Slot pill coloured by Version status, as used on posters and episode cards. */
export function SlotPill({ slot, tone, title, size = 'md' }: { slot: Slot; tone: Tone; title?: string; size?: 'sm' | 'md' }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded font-mono font-semibold tracking-tight', size === 'sm' ? 'h-[18px] px-1 text-[10px]' : 'h-5 px-1.5 text-[11px]', toneSoft[tone])}>
      {slot}
    </span>
  )
}
export const versionPill = (v: Version) => {
  const s = versionStatus(v)
  return <SlotPill key={v.slot} slot={v.slot} tone={s.tone} title={`${v.slot} · ${s.label}`} />
}

// ── Dates ───────────────────────────────────────────────────────────────────

const d = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z')
export const fmtDate = (s: string) => d(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const fmtDay = (s: string) => d(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export function relDays(s: string) {
  const n = daysBetween(TODAY, s.slice(0, 10))
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

export function SectionTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h3 className="text-[15px] font-semibold tracking-tight">{children}</h3>
        {sub && <p className="mt-0.5 text-[13px] text-gray-900">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-gray-900">{sub}</p>}
      </div>
      {right}
    </div>
  )
}
