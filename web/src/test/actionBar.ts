import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The design ActionBar has no role of its own: tests find it by its class, and read its count from its label.

/** The open ActionBar (ticked rows, unsaved changes); throws when none is open. */
export function actionBar(): HTMLElement {
  const bar = queryActionBar()
  if (!bar) throw new Error('no ActionBar is open')
  return bar
}

/** The open ActionBar, or null. */
export function queryActionBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.hy-action-bar')
}

/**
 * Runs one of the bar's quiet actions (Select All, a `secondaryActions` entry): its text button when the bar is wide, else
 * the item of its More actions menu, which is where jsdom's zero-width container puts it.
 */
export async function runQuiet(bar: HTMLElement, name: string | RegExp) {
  const button = within(bar).queryByRole('button', { name })
  if (button) return userEvent.click(button)
  await userEvent.click(within(bar).getByRole('button', { name: 'More actions' }))
  await userEvent.click(screen.getByRole('menuitem', { name }))
}
