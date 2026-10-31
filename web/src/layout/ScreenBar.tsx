// chrome: layout
import { Menu, MenuItem } from '@hyprsh/design'
import type { ReactNode } from 'react'

/**
 * The bar under the top bar that Library, Upcoming, Activity and Log share: one row, full width and left-aligned with the
 * page title. From the left: `view` (the ViewSwitcher of a screen with several pages), `filter` (the text field, with its
 * `?`), `controls` (a FilterButton, a SortButton), `end` (the Library's grid/list switch) and `count` ("6 of 6",
 * "3 events"); at the right end, `menu` (a "…" menu) and `actions` (at most one primary button). On a phone the row wraps:
 * the field takes a full line of its own and the buttons go under it.
 */
export function ScreenBar({
  view,
  filter,
  controls,
  end,
  count,
  menu,
  actions,
}: {
  view?: ReactNode
  filter?: ReactNode
  controls?: ReactNode
  end?: ReactNode
  count?: ReactNode
  menu?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-gray-alpha-400 px-4 py-2">
      {view}
      {filter && <div className="min-w-0 basis-full sm:max-w-md sm:flex-1 sm:basis-64">{filter}</div>}
      {controls}
      {(end || count) && (
        <div className="flex items-center gap-3">
          {end}
          {count}
        </div>
      )}
      {(menu || actions) && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {menu}
          {actions}
        </div>
      )}
    </div>
  )
}

/** One page of a screen that has several, in the ViewSwitcher; `hint` is shown after its name, such as a count. */
export type ScreenView<T extends string> = { value: T; label: string; hint?: ReactNode }

/**
 * The view switcher at the start of a screen bar: a menu button naming the current page ("Grabs"), listing the pages
 * (Grabs, Health, Background Jobs). It is for pages, which a Filter cannot stand in for.
 */
export function ViewSwitcher<T extends string>({ label, views, current, onChange }: { label: string; views: readonly ScreenView<T>[]; current: T; onChange: (view: T) => void }) {
  return (
    <Menu.Container position="bottom-start">
      <Menu.Button variant="tertiary" size="small" showChevron aria-label={`${label}: ${views.find((v) => v.value === current)?.label}`}>
        {views.find((v) => v.value === current)?.label}
      </Menu.Button>
      <Menu width={220} aria-label={label}>
        {views.map((v) => (
          <MenuItem key={v.value} role="radio" checked={v.value === current} suffix={v.hint} onSelect={() => onChange(v.value)}>
            {v.label}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )
}

/** The result count at the far right of the filter row: "6 of 6", "3 events". */
export function ScreenCount({ children }: { children: ReactNode }) {
  return <span className="label-12 shrink-0 text-gray-900 tabular-nums">{children}</span>
}
