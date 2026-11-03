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
