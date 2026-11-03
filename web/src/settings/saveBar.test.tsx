// The Save bar's reach beyond one page: leaving Settings for another screen, and the phone's list with its status lines.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => history.replaceState(null, '', '/'))

describe('leaving Settings with unsaved changes', () => {
  it('asks before another screen opens from the rail, and stays on Settings when told to keep editing', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.selectOptions(await screen.findByLabelText('Primary language'), 'de')
    expect(screen.getByText('2 unsaved changes · Primary language, Country', { selector: '.hy-action-bar__label' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    const ask = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Primary language')).toHaveValue('de')

    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Discard and leave' }))
    await waitFor(() => expect(screen.queryByLabelText('Primary language')).not.toBeInTheDocument())
  })

  it('does not ask when nothing changed', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await screen.findByLabelText('Primary language')
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument()
  })
})

describe('Settings on a phone: the list', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  afterEach(() => vi.unstubAllGlobals())

  it('groups the sections with a line of status under each, amber when one needs attention', async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json({
          download_client: { state: 'ok', name: 'SABnzbd', instance_id: 1, message: null },
          indexers: [
            {
              instance_id: 2,
              name: 'altHUB',
              state: 'failing',
              message: 'bad API key',
              search_used: 0,
              search_max: null,
              grab_used: null,
              grab_max: null,
              search_paused_until: null,
              grabs_paused: false,
              grabs_paused_until: null,
            },
          ],
          disks: [],
          trash: { commit: 'abc', committed_at: null, checked_at: null, auto_update: true },
          grabs_paused: false,
          version: '1.8.2',
          started_at: new Date().toISOString(),
          services: [],
        } as never),
      ),
    )
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))

    const list = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(list).getByRole('region', { name: 'Connections' })).toBeInTheDocument()
    const downloads = await within(list).findByRole('button', { name: /^Downloads/ })
    expect(await within(list).findByText('altHUB failing: bad API key')).toBeInTheDocument()
    expect(downloads).toBeInTheDocument()
    expect(within(list).getByText('English · US · oldest season first')).toBeInTheDocument()
  })

  it('finds a setting and lists only the sections that hold it', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    await user.type(await screen.findByRole('searchbox', { name: 'Find a setting' }), 'indexers')
    const list = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    expect(within(list).getByRole('button', { name: /^Downloads/ })).toBeInTheDocument()
    expect(within(list).getByText('Indexers')).toBeInTheDocument()
  })
})
