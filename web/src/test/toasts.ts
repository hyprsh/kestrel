import { screen, within } from '@testing-library/react'

/** The Toast host's region: where a Toast is announced. */
export const toastRegion = () => screen.findByRole('region', { name: 'Notifications' })

/** The Toast whose text matches, once it shows. */
export async function findToast(text: string | RegExp) {
  return within(await toastRegion()).findByText(text)
}
