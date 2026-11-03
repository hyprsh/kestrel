// chrome: layout
import { StatusDot } from '@hyprsh/design'
import type { ComponentProps, ReactNode } from 'react'

/**
 * The top of a Settings page: its title (`heading-24`, focused when the page opens) and one line under it that says what
 * the page holds and states any problem ("1 indexer needs attention"). `hideTitle` keeps the heading for a screen reader
 * only, where a phone's Back header already shows it.
 */
export function SettingsHeader({ id, title, summary, hideTitle = false }: { id: string; title: string; summary: ReactNode; hideTitle?: boolean }) {
  return (
    <header className="mb-6 flex flex-col gap-1">
      <h2 id={id} tabIndex={-1} className={hideTitle ? 'sr-only' : 'heading-24'}>
        {title}
      </h2>
      <p className="copy-14 text-gray-900">{summary}</p>
    </header>
  )
}

/** A group on a Settings page: a `heading-16` over a card, with `action` (buttons) at the heading's right edge. */
export function SettingsSection({ id, title, count, action, children }: { id?: string; title?: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex scroll-mt-4 flex-col gap-2.5">
      {(title || action) && (
        <div className="flex min-h-8 items-center gap-2">
          <h3 className="heading-16 min-w-0 flex-1">
            {title}
            {count !== undefined && <span className="label-14 ml-2 font-normal text-gray-900">{count}</span>}
          </h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** The card of a Settings section: plain rows one under another, divided. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md shadow-border [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-gray-alpha-200">{children}</div>
}

/** A card that holds one block of its own (the download client, the setup wizard), padded. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-md p-4 shadow-border">{children}</div>
}

/**
 * One setting: its name and explanation at the left, its control at the right. `dirty` draws the blue edge of an
 * unsaved change. `stacked` puts the control under the text across the card, for a form of several fields.
 */
// chrome-ok: adopting the design SettingRow is a separate ticket
export function SettingRow({ label, help, dirty = false, stacked = false, children }: { label: string; help?: ReactNode; dirty?: boolean; stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={`grid gap-x-6 gap-y-3 px-4 py-3.5 ${stacked ? '' : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)] sm:items-center'} ${dirty ? 'shadow-[inset_2px_0_0_var(--blue-700)]' : ''}`}>
      <div className="min-w-0">
        <h4 className="label-14 font-medium">{label}</h4>
        {help && <div className="copy-13 text-gray-900">{help}</div>}
      </div>
      {children !== undefined && <div className={`flex min-w-0 flex-col gap-2 ${stacked ? '' : 'sm:items-end'}`}>{children}</div>}
    </div>
  )
}

/** A line of a setting's control column that is not the control: a note or an error under it, kept to the card's text size. */
export function SettingRowBody({ children }: { children: ReactNode }) {
  return <div className="flex w-full min-w-0 flex-col gap-2">{children}</div>
}

/**
 * The bar that floats at the foot of a page while something on it has changed: how many changes and their names, then
 * Discard and Save (`actions`).
 */
export function SettingsBar({ count, names, children }: { count: number; names: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 mt-6 flex">
      <div role="region" aria-label="Unsaved changes" className="pointer-events-auto flex w-full min-w-0 flex-wrap items-center gap-3 rounded-xl bg-background-100 py-2.5 pr-3 pl-4 shadow-menu">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-blue-700" />
        <span className="label-14 min-w-0 flex-1 basis-48">
          {count} unsaved {count === 1 ? 'change' : 'changes'} · {names}
        </span>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  )
}

type DotState = ComponentProps<typeof StatusDot>['state']

/** A status in a line: a coloured dot and its words ("Connected · version 4.3.2"). `tone` colours the words too when it is a problem. */
export function StatusLine({ state, tone = 'normal', children }: { state: DotState; tone?: 'normal' | 'problem' | 'muted'; children: ReactNode }) {
  const colour = tone === 'problem' ? 'text-red-900' : tone === 'muted' ? 'text-gray-900' : state === 'success' ? 'text-green-900' : ''
  return (
    <span className={`label-13 flex min-w-0 items-center gap-1.5 ${colour}`}>
      <StatusDot state={state} label={false} aria-hidden className="shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

/** The placement of a card's `Description`s (address, category, queue, free space): in as many columns as fit, under a rule. */
export function DescriptionGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 border-t border-gray-alpha-200 pt-3 sm:grid-cols-4">{children}</div>
}
