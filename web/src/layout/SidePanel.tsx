// chrome: layout
import { Button, Pill } from '@hyprsh/design'
import { X } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { usePhone } from '../responsive'

/** The panel's width in px on a desktop: the Library's list column is wide, every other screen's panel is narrow. */
export const SIDE_PANEL_WIDTH = { wide: 380, narrow: 280 } as const
// Tailwind reads class names off the source text, so these spell the widths above out; keep the two in step.
const widthClass = { wide: 'w-[380px]', narrow: 'w-[280px]' } as const

/**
 * What a phone's panel header shows between the screen name and the screen's own actions (what runs, Health). The Shell
 * provides it, so a screen gets them without knowing about either.
 */
export const SidePanelPhoneContext = createContext<ReactNode>(null)

/**
 * The side panel of a screen: on a desktop the column right of the rail that holds what the full-width top bar once did.
 * The screen renders it as the first child of its own row, with its content after it. On a phone the same props become the
 * screen's top header: the name with Health and the actions, and under them the filter field with the controls as icons.
 *
 * Top to bottom: the header (`title` as the h1, then `actions`, the icon buttons: a "…" menu, at most one primary "+"),
 * the `filter` field at full width, `controls` (a FilterButton, a SortButton) on a row, `chips` (FilterChips), `views`
 * (SidePanelViews), the body (`children`: the Library's list, Settings' sections; it fills the rest and scrolls itself)
 * and the `footer`. Every part but the title is optional. A phone shows no `views`, no body and no footer: the body is the
 * screen's content there, so the screen renders it after the panel.
 */
export function SidePanel({
  title,
  width = 'narrow',
  actions,
  filter,
  controls,
  chips,
  views,
  footer,
  children,
}: {
  /** The screen's name: the h1 and the panel's accessible name. */
  title: string
  width?: keyof typeof SIDE_PANEL_WIDTH
  actions?: ReactNode
  filter?: ReactNode
  controls?: ReactNode
  chips?: ReactNode
  views?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}) {
  const phone = usePhone()
  const extras = useContext(SidePanelPhoneContext)
  if (phone)
    return (
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-gray-alpha-200 bg-background-200 px-4 pt-3 pb-2.5">
        <div className="flex h-8 items-center gap-2">
          <h1 className="heading-20 min-w-fit flex-1">{title}</h1>
          {extras}
          {actions}
        </div>
        {(filter || controls) && (
          <div className="flex items-center gap-2">
            {filter && <div className="min-w-0 flex-1">{filter}</div>}
            {controls}
          </div>
        )}
        {chips}
      </header>
    )
  return (
    <aside aria-label={title} className={`flex min-h-0 shrink-0 flex-col border-r border-gray-alpha-200 bg-background-200 ${widthClass[width]}`}>
      <div className="flex shrink-0 flex-col gap-2.5 pt-3.5 pr-3 pb-2.5 pl-4">
        <div className="flex h-8 items-center gap-2">
          <h1 className="heading-20 min-w-0 flex-1 truncate">{title}</h1>
          {actions}
        </div>
        {filter}
        {controls && <div className="flex items-center gap-2">{controls}</div>}
        {chips}
      </div>
      {views && <div className="min-h-0 shrink overflow-y-auto px-2 pb-3">{views}</div>}
      {children ? <div className="relative flex min-h-0 flex-1 flex-col border-t border-gray-alpha-200 bg-background-100">{children}</div> : <div className="flex-1" />}
      {footer && <footer className="label-12 flex shrink-0 items-center justify-between gap-3 border-t border-gray-alpha-200 px-4 py-2 text-gray-900">{footer}</footer>}
    </aside>
  )
}

/**
 * The main content beside a panel: it scrolls itself and pads its content 24px above and below and 32px at the sides (16 all
 * round on a phone). `reading` keeps the column to 880px, left aligned, for text and cards (Settings, Activity, Health); a
 * screen of a wide list or grid (Upcoming) leaves it off. The Log's table runs edge to edge and has no PanelContent. It is
 * `relative` so a screen reader's hidden table (`sr-only`, absolutely placed) stays inside it rather than lengthening the page.
 */
export function PanelContent({ reading = false, children }: { reading?: boolean; children: ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">
      <div className={`p-4 sm:px-8 sm:py-6 ${reading ? 'max-w-[880px]' : ''}`}>{children}</div>
    </div>
  )
}

/** One removable chip of the active filter, for FilterChips: `label` ("Wanted") and what removing it does. */
export type FilterChip = { key: string; label: string; onRemove: () => void }

/**
 * The active filter terms as removable chips under the Filter and Sort row. Each is a button named "Remove Wanted";
 * nothing renders while there are none. `filterChips` (src/filter/chips.ts) builds them from a query.
 */
export function FilterChips({ chips }: { chips: readonly FilterChip[] }) {
  if (chips.length === 0) return null
  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={c.key}>
          <Pill size="sm" onClick={c.onRemove} aria-label={`Remove ${c.label}`}>
            <span className="inline-flex items-center gap-1">
              {c.label}
              <X className="size-3" aria-hidden />
            </span>
          </Pill>
        </li>
      ))}
    </ul>
  )
}

/**
 * The look of one row of a panel's list (Views, Settings' sections): 34px, left aligned, the name at the left and the count
 * at the right edge, the current one raised. A row is a Button (or ButtonLink) with these props, so every panel's rows match.
 */
export const panelRowClass = String.raw`h-[34px] justify-start font-normal aria-[current=true]:font-medium [&_.hy-btn\_\_label]:flex [&_.hy-btn\_\_label]:min-w-0 [&_.hy-btn\_\_label]:flex-1 [&_.hy-btn\_\_label]:items-center [&_.hy-btn\_\_label]:justify-between [&_.hy-btn\_\_label]:gap-2 [&_.hy-btn\_\_label]:text-left`

/** The title over a run of a panel's rows ("Views", or a Settings group): small and muted. */
export const panelRowsTitleClass = 'label-12 px-2.5 py-1 text-gray-900'

/** The "Views" section of a panel: a short list of named pages or presets of the screen (Log's Errors, Upcoming's This week). */
export function SidePanelViews({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Views" className="flex flex-col gap-0.5">
      <span className={panelRowsTitleClass}>Views</span>
      {children}
    </nav>
  )
}

/**
 * One row of SidePanelViews: an optional icon, the name at the left, and a count at the right edge; `current` marks the chosen
 * one (the Button's raised look, with `aria-current`). The count is part of the row's name, so a screen reader hears "Errors, 3".
 */
export function SidePanelView({ icon, count, current = false, onSelect, children }: { icon?: ReactNode; count?: ReactNode; current?: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <Button variant={current ? 'secondary' : 'tertiary'} size="small" width="100%" aria-current={current ? 'true' : undefined} prefix={icon} className={panelRowClass} onClick={onSelect}>
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className="label-12 shrink-0 tabular-nums text-gray-900">
          <span className="sr-only">, </span>
          {count}
        </span>
      )}
    </Button>
  )
}
