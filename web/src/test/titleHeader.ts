import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Opens the Title menu of a Title page's header and returns it. */
export async function openTitleMenu(pane: HTMLElement) {
  await userEvent.click(await within(pane).findByRole('button', { name: 'Title actions' }))
  return screen.findByRole('menu', { name: 'Title actions' })
}

/** Opens one of the Title menu's submenus ("Metadata", "Files", "Open in") and returns it. */
export async function openTitleSubmenu(pane: HTMLElement, group: string) {
  const menu = await openTitleMenu(pane)
  await userEvent.click(within(menu).getByRole('menuitem', { name: group }))
  return screen.findByRole('menu', { name: group })
}

/** Picks an item of the Title menu; `group` names the submenu it sits in ("Metadata", "Files", "Open in"). */
export async function chooseTitleItem(pane: HTMLElement, name: string | RegExp, group?: string) {
  let menu = await openTitleMenu(pane)
  if (group) {
    await userEvent.click(within(menu).getByRole('menuitem', { name: group }))
    menu = await screen.findByRole('menu', { name: group })
  }
  await userEvent.click(within(menu).getByRole('menuitem', { name }))
}

/** Opens the dropdown of the header's Search button and returns its menu. */
export async function openSearchMenu(pane: HTMLElement) {
  await userEvent.click(await within(pane).findByRole('button', { name: 'More search options' }))
  return screen.findByRole('menu', { name: 'More search options' })
}

/** Picks an item of the Search button's dropdown. */
export async function chooseSearchItem(pane: HTMLElement, name: string | RegExp) {
  const menu = await openSearchMenu(pane)
  await userEvent.click(within(menu).getByRole('menuitem', { name }))
}

/** Opens a Version row's "⋯" menu: `slot` is its name ("Standard", "4K"). */
export async function openVersionMenu(pane: HTMLElement, slot: string) {
  await userEvent.click(await within(pane).findByRole('button', { name: `${slot} Actions` }))
  return screen.findByRole('menu', { name: `${slot} Actions` })
}
