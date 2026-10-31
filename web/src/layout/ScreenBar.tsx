// chrome: layout
import { Menu, MenuItem } from '@hyprsh/design'
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where a screen's bar goes. On a desktop the Shell's top bar offers two places, the middle (where the command box sits on the
 * other screens) and the end (after the Health pill); a ScreenBar portals into them, so its state and focus stay in the screen
 * that renders it. Without them (a phone, a test) the bar is one row of its own under the top bar. `null` places are not
 * mounted yet: the bar waits for them.
 */
export type ScreenBarPlaces = { middle: HTMLElement | null; end: HTMLElement | null }
export const ScreenBarPlacesContext = createContext<ScreenBarPlaces | undefined>(undefined)

/**
 * The bar of Library, Upcoming, Activity and Log. In the top bar of a desktop it is, from the left: `view` (the ViewSwitcher of a
 * screen with several pages), `filter` (the text field, with its `?`), `controls` (a FilterButton, a Display menu), `aside`
 * (a screen's own button, pushed to the right, such as Today); and after the Health pill `menu` (a "…" menu) and `actions` (at
 * most one primary button). On a phone it is one row under the top bar that wraps: the field takes a full line of its own and
 * the buttons go under it.
 */
export function ScreenBar({ view, filter, controls, aside, menu, actions }: { view?: ReactNode; filter?: ReactNode; controls?: ReactNode; aside?: ReactNode; menu?: ReactNode; actions?: ReactNode }) {
  const places = useContext(ScreenBarPlacesContext)
  const right = (menu || actions) && (
    <>
      {menu}
      {actions}
    </>
  )
  if (places) {
    return (
      <>
        {places.middle &&
          createPortal(
            <>
              {view}
              {filter && <div className="min-w-0 max-w-md flex-1">{filter}</div>}
              {controls}
              {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
            </>,
            places.middle,
          )}
        {places.end && right && createPortal(right, places.end)}
      </>
    )
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-gray-alpha-400 px-4 py-2">
      {view}
      {filter && <div className="min-w-0 basis-full sm:max-w-md sm:flex-1 sm:basis-64">{filter}</div>}
      {controls}
      {(aside || right) && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
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
