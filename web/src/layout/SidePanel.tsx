// chrome: layout
import { NavList, Pill } from '@hyprsh/design'
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
 * The "Views" section of a panel: a short list of named pages or presets of the screen (Log's Errors, Upcoming's This week). Its
 * rows are the design's `NavItem` with an `icon`, `current`, an `onClick` and a `trailing` count (a number joins the row's name).
 */
export function SidePanelViews({ children }: { children: ReactNode }) {
  return (
    <NavList aria-label="Views">
      <NavList.Group title="Views">{children}</NavList.Group>
    </NavList>
  )
}
