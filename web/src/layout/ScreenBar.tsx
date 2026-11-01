// chrome: layout
import { Menu, MenuItem } from '@hyprsh/design'
import type { ReactNode } from 'react'

/**
 * The bar of Upcoming, Activity and Log, until they move onto a SidePanel (phase 2): one row at the top of the screen's
 * content, from the left: `view` (the ViewSwitcher of a screen with several pages), `filter` (the text field, with its
 * `?`), `controls` (a FilterButton, a SortButton), `aside` (a screen's own button, pushed to the right, such as Today); and
 * at the end `menu` (a "…" menu) and `actions` (at most one primary button). On a phone the buttons (Filter, Display, a
 * "…" menu) are icons. A screen with a SidePanel does not use it.
 */
export function ScreenBar({ view, filter, controls, aside, menu, actions }: { view?: ReactNode; filter?: ReactNode; controls?: ReactNode; aside?: ReactNode; menu?: ReactNode; actions?: ReactNode }) {
  const right = (menu || actions) && (
    <>
      {menu}
      {actions}
    </>
  )
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-gray-alpha-400 px-4 py-2">
      {view}
      {filter && <div className="min-w-0 flex-1">{filter}</div>}
      {controls}
      {(aside || right) && (
        <div className={`flex shrink-0 items-center gap-2 ${filter ? '' : 'ml-auto'}`}>
          {aside}
          {right}
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
