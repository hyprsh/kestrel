import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const search = (versions: number, pass: { done: number; total: number } | null = null) =>
  server.use(
    http.get('/search/status', ({ response }) =>
      response(200).json({
        due: { versions, episodes: 0, upgrades: 0 },
        pass: pass && { started_at: new Date().toISOString(), ...pass },
        next_pass_at: null,
        last_pass: null,
        upgrades_per_pass: 5,
        indexers: [],
      }),
    ),
  )

/** The Health screen's Searching card, and its button. */
async function card() {
  history.replaceState(null, '', '/health/jobs')
  renderApp()
  const region = await screen.findByRole('region', { name: 'Searching' })
  return within(region).getByRole('button', { name: 'Search all Wanted' })
}

beforeEach(() => history.replaceState(null, '', '/'))

describe('the Searching card on Health', () => {
  it('queues every Wanted Version for a search and says how many in a Toast', async () => {
    search(12)
    let posted = 0
    server.use(
      http.post('/wanted/search', ({ response }) => {
        posted++
        return response(202).json({ versions: 12 })
      }),
    )
    const button = await card()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await findToast('12 Wanted Versions queued for a search')).toBeInTheDocument()
    expect(posted).toBe(1)
  })

  it('says in a Toast when the search could not be queued', async () => {
    search(3)
    server.use(http.post('/wanted/search', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'boom', detail: 'the indexer is down' }, { status: 500 })))
    await userEvent.click(await card())
    expect(await findToast(/search all wanted failed: the indexer is down/i)).toBeInTheDocument()
  })

  it('is disabled while the request runs', async () => {
    search(3)
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    server.use(
      http.post('/wanted/search', async ({ response }) => {
        await held
        return response(202).json({ versions: 3 })
      }),
    )
    const button = await card()
    await userEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: /Search all Wanted/ })).toBeDisabled())
    release()
    await findToast('3 Wanted Versions queued for a search')
  })

  it('is disabled while a pass is running, saying why', async () => {
    search(12, { done: 3, total: 12 })
    const button = await card()
    expect(button).toBeDisabled()
    expect(button.closest('span[title]')).toHaveAttribute('title', 'A search pass is running')
  })

  it('is disabled when nothing is Wanted', async () => {
    search(0)
    expect(await card()).toBeDisabled()
  })
})
