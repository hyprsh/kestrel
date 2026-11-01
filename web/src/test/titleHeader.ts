import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Opens the Title menu of a Title page's header and returns it. */
export async function openTitleMenu(pane: HTMLElement) {
  await userEvent.click(await within(pane).findByRole('button', { name: 'Title actions' }))
  return screen.findByRole('menu', { name: 'Title actions' })
}

/** Picks an item of the Title menu. */
export async function chooseTitleItem(pane: HTMLElement, name: string | RegExp) {
  const menu = await openTitleMenu(pane)
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

/** Opens a Version's "…" menu: `slot` is its name ("Standard", "4K"). */
export async function openVersionMenu(pane: HTMLElement, slot: string) {
  await userEvent.click(await within(pane).findByRole('button', { name: `${slot} Version actions` }))
  return screen.findByRole('menu', { name: `${slot} Version actions` })
}
