import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeGrabs, grabEntry } from '../test/grabs'
import { fakeQueue, queueItem } from '../test/queue'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search
/** The view switcher, naming the page the screen is on. */
const onView = (name: string) => screen.findByRole('button', { name: `Activity: ${name}` })
/** Opens the switcher and picks a page. */
async function goTo(name: RegExp | string, user = userEvent) {
  await user.click(await screen.findByRole('button', { name: /^Activity:/ }))
  await user.click(await screen.findByRole('menuitemradio', { name }))
}
/** The switcher's open menu, to read what each page shows beside its name. */
async function openSwitcher() {
  await userEvent.click(await screen.findByRole('button', { name: /^Activity:/ }))
  return screen.findByRole('menu')
}

beforeEach(() => history.replaceState(null, '', '/'))

describe('Activity views', () => {
  it('lists Grabs and Background Jobs in the switcher, without Health, Grabs selected at /activity with the number of active Grabs', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' }), queueItem({ grab_id: 2, phase: 'queued' })])
    history.replaceState(null, '', '/activity')
    renderApp()

    expect(await onView('Grabs')).toBeInTheDocument()
    const menu = await openSwitcher()
    expect(within(menu).getByRole('menuitemradio', { name: 'Grabs' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Grabs' })).toHaveTextContent('2'))
    expect(within(menu).queryByRole('menuitemradio', { name: 'Health' })).not.toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2)
    expect(within(menu).getByRole('menuitemradio', { name: 'Background Jobs' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toBeInTheDocument()
  })

  it('gives each tab its own address and keeps the Grabs ?q=', async () => {
    history.replaceState(null, '', '/activity?q=stage:done')
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' })])
    renderApp()
    expect(await screen.findByRole('region', { name: 'Done · 1' })).toBeInTheDocument()

    await goTo('Background Jobs')
    expect(url()).toBe('/activity/jobs')
    await goTo('Grabs')
    expect(url()).toBe('/activity?q=stage%3Adone')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:done')
  })

  it('opens at /activity/jobs and the old /activity/running (Background Jobs)', async () => {
    for (const [path, name] of [
      ['/activity/jobs', 'Background Jobs'],
      ['/activity/running', 'Background Jobs'],
    ] as const) {
      history.replaceState(null, '', path)
      const { unmount } = renderApp()
      expect(await onView(name)).toBeInTheDocument()
      unmount()
    }
    history.replaceState(null, '', '/activity/running')
    renderApp()
    expect(await screen.findByRole('region', { name: /^Running now/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^Background jobs/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter Activity' })).not.toBeInTheDocument()
  })

  it('moves between tabs with Back and Forward', async () => {
    history.replaceState(null, '', '/activity')
    renderApp()
    await goTo('Background Jobs')

    history.back()
    expect(await onView('Grabs')).toBeInTheDocument()
    expect(url()).toBe('/activity')
    history.forward()
    expect(await onView('Background Jobs')).toBeInTheDocument()
  })
})
