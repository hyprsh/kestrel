// PROTOTYPE, throwaway. Variant A shell: left sidebar, page header, Geist tabs, table cells, dialog.
import type { ComponentProps, InputHTMLAttributes, ReactNode } from 'react'
import { Activity, CalendarClock, ChevronRight, Info, Library, Plus, Settings, X } from 'lucide-react'
import { go, navigate, useParam } from '../../nav'
import { Button as GeistButton, Dot, KestrelLogo, cx } from '../../ui'
import { useStore } from './store'

/** ui.tsx's Button/Input type `prefix` as the HTML string attribute, so icons go through these thin wrappers. */
export function Button({ prefix, children, ...rest }: Omit<ComponentProps<typeof GeistButton>, 'prefix'> & { prefix?: ReactNode }) {
  return (
    <GeistButton {...rest}>
      {prefix}
      {children}
    </GeistButton>
  )
}

export function Input({ className, prefix, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { prefix?: ReactNode }) {
  return (
    <label className={cx('flex h-9 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-100 px-3 text-sm focus-within:border-gray-600 focus-within:ring-2 focus-within:ring-gray-alpha-400', className)}>
      {prefix && <span className="text-gray-900">{prefix}</span>}
      <input {...rest} className="w-full bg-transparent outline-none placeholder:text-gray-700" />
    </label>
  )
}

export function Sidebar() {
  const screen = useParam('screen', 'library')
  const { queue, settings } = useStore()
  const active = screen === 'title' || screen === 'search' || screen === 'add' ? 'library' : screen
  const items = [
    { key: 'library', label: 'Library', icon: Library },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
    { key: 'activity', label: 'Activity', icon: Activity, count: queue.length },
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'about', label: 'About', icon: Info },
  ]
  const okIdx = settings.indexers.filter((i) => i.status === 'ok').length
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-gray-alpha-400 bg-background-200">
      <button onClick={() => go('library')} className="flex h-14 items-center gap-2 px-4 text-left">
        <KestrelLogo />
        <span className="text-[15px] font-semibold tracking-tight">Kestrel</span>
        <span className="ml-auto rounded border border-gray-alpha-400 px-1.5 font-mono text-[10px] text-gray-900">0.1</span>
      </button>
      <div className="px-3 pb-3">
        <Button variant="primary" size="sm" className="w-full" prefix={<Plus className="size-4" />} onClick={() => navigate({ add: '1' })}>
          Add Title
        </Button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => go(it.key)}
            className={cx(
              'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
              active === it.key ? 'bg-gray-alpha-200 font-medium text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000',
            )}
          >
            <it.icon className="size-4" strokeWidth={1.75} />
            {it.label}
            {it.count ? <span className="tabular ml-auto rounded-full bg-blue-700 px-1.5 text-[11px] font-medium leading-[18px] text-white">{it.count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="mt-auto border-t border-gray-alpha-400 px-4 py-3 text-[12px] text-gray-900">
        <button onClick={() => go('settings', { section: 'download' })} className="flex w-full items-center gap-2 py-1 hover:text-gray-1000">
          <Dot tone="green" /> SABnzbd
          <span className="ml-auto font-mono text-[11px]">4.5.3</span>
        </button>
        <button onClick={() => go('settings', { section: 'indexers' })} className="flex w-full items-center gap-2 py-1 hover:text-gray-1000">
          <Dot tone={okIdx === settings.indexers.length ? 'green' : 'amber'} /> Indexers
          <span className="tabular ml-auto font-mono text-[11px]">
            {okIdx}/{settings.indexers.length} up
          </span>
        </button>
        <div className="flex items-center gap-2 py-1">
          <Dot tone="green" /> Metadata
          <span className="ml-auto font-mono text-[11px]">04:00</span>
        </div>
      </div>
    </aside>
  )
}

export type Crumb = { label: string; onClick?: () => void }
export function PageHeader({ title, crumbs, actions, children, sub }: { title: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; children?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="border-b border-gray-alpha-400 bg-background-100">
      <div className="mx-auto flex max-w-[1400px] items-end justify-between gap-6 px-8 pb-5 pt-6">
        <div className="min-w-0">
          {crumbs && (
            <div className="mb-2 flex items-center gap-1 text-[13px] text-gray-900">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5 text-gray-600" />}
                  {c.onClick ? (
                    <button onClick={c.onClick} className="hover:text-gray-1000">
                      {c.label}
                    </button>
                  ) : (
                    <span className="text-gray-1000">{c.label}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {sub && <div className="mt-1 text-sm text-gray-900">{sub}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mx-auto max-w-[1400px] px-8">{children}</div>}
    </header>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto max-w-[1400px] px-8 py-6', className)}>{children}</div>
}

/** Geist tabs: text items with an underline on the active one. Drives a URL param. */
export function Tabs({ tabs, value, param = 'tab' }: { tabs: { key: string; label: ReactNode; count?: number }[]; value: string; param?: string }) {
  return (
    <div className="-mb-px flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => navigate({ [param]: t.key }, true)}
          className={cx(
            'relative flex h-10 items-center gap-1.5 px-2.5 text-[13px] transition-colors',
            value === t.key ? 'text-gray-1000' : 'text-gray-900 hover:text-gray-1000',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular rounded-full bg-gray-alpha-200 px-1.5 text-[11px] leading-[18px] text-gray-1000">{t.count}</span>}
          {value === t.key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gray-1000" />}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { key: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={cx('inline-flex rounded-md border border-gray-alpha-400 bg-background-200 p-0.5', size === 'sm' ? 'h-8' : 'h-9')}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cx(
            'flex items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] transition-colors',
            value === o.key ? 'bg-background-100 font-medium text-gray-1000 shadow-[0_0_0_1px_var(--ds-gray-alpha-400)]' : 'text-gray-900 hover:text-gray-1000',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const th = 'h-9 px-3 text-left text-[12px] font-medium text-gray-900 whitespace-nowrap'
export const td = 'px-3 py-2.5 align-middle'

export function Table({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-lg border border-gray-alpha-400 bg-background-100', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="border-b border-gray-alpha-400 bg-background-200">
          <tr>{head}</tr>
        </thead>
        <tbody className="[&>tr:not(:last-child)]:border-b [&>tr]:border-gray-alpha-400">{children}</tbody>
      </table>
    </div>
  )
}

export function Card({ title, description, children, footer, className, actions }: { title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-lg border border-gray-alpha-400 bg-background-100', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-1 text-[13px] text-gray-900">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && <div className="flex items-center justify-between gap-4 rounded-b-lg border-t border-gray-alpha-400 bg-background-200 px-5 py-3 text-[13px] text-gray-900">{footer}</div>}
    </section>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] items-start gap-6 py-3">
      <div className="pt-2">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-gray-900">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Progress({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'green' | 'gray' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-alpha-200">
      <div className={cx('h-full rounded-full', tone === 'blue' && 'bg-blue-700', tone === 'green' && 'bg-green-700', tone === 'gray' && 'bg-gray-600')} style={{ width: `${value}%` }} />
    </div>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--ds-gray-1000)]" />
      {label}
    </label>
  )
}

export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background-200/70 px-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className={cx('w-full rounded-xl border border-gray-alpha-400 bg-background-100 shadow-[0_8px_30px_rgba(0,0,0,0.12)]', width)}>
        <div className="flex items-center justify-between px-5 pb-1 pt-5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-gray-alpha-400 bg-background-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Toast() {
  const { toast } = useStore()
  if (!toast) return null
  return (
    <div className="fixed bottom-16 right-6 z-50 flex items-center gap-2 rounded-lg border border-gray-alpha-400 bg-background-100 px-4 py-3 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
      <Dot tone="green" /> {toast}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-gray-alpha-400 px-6 py-10 text-center text-[13px] text-gray-900">{children}</div>
}
