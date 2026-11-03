// chrome: layout
import { StatusDot } from '@hyprsh/design'
import type { ComponentProps, ReactNode } from 'react'

/**
 * The top of a Settings page: its title (`heading-24`, focused when the page opens) and one line under it that says what
 * the page holds and states any problem ("1 indexer needs attention"). `hideTitle` leaves the heading out, where a
 * phone's Back header (the TitleBar's `h1`, see `focusPageHeading`) already shows it.
 */
export function SettingsHeader({ id, title, summary, hideTitle = false }: { id: string; title: string; summary: ReactNode; hideTitle?: boolean }) {
  return (
    <header className="mb-6 flex flex-col gap-1">
      {!hideTitle && (
        <h2 id={id} tabIndex={-1} className="heading-24">
          {title}
        </h2>
      )}
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

/** The card of a Settings section: rows one under another, divided (the design `SettingRow` draws its own divider and has no right padding). */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md shadow-border [&>.hy-setting-row]:pr-3 [&>*:not(.hy-setting-row):not(:last-child)]:border-b [&>*:not(.hy-setting-row):not(:last-child)]:border-gray-alpha-200">
      {children}
    </div>
  )
}

/** A card that holds one block of its own (the download client, the setup wizard), padded. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-md p-4 shadow-border">{children}</div>
}

/**
 * One setting that is a form of several fields, not one control: its name and explanation, then the form across the card
 * (the design `SettingRow` puts a single control in a 280px column beside the text and names it with `<label for>`, which
 * a form cannot take). A single control uses the design `SettingRow` instead.
 */
export function StackedSetting({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-y-3 py-3.5 px-3 [.hy-setting-row+&]:border-t [.hy-setting-row+&]:border-gray-alpha-200">
      <div className="min-w-0">
        <h4 className="label-14 font-medium">{label}</h4>
        {help && <div className="copy-13 text-gray-900">{help}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
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
