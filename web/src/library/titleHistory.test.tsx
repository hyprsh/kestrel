import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Event = components['schemas']['Event']

const event = (id: number, kind: string, message: string, minutesAgo: number): Event => ({
  id,
  at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  kind,
  routine: false,
  title_id: 1,
  version_id: 11,
  episode_id: null,
  grab_id: null,
  request_id: null,
  message,
  trigger: null,
  reason: '',
  data: null,
})

async function openPaddington() {
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return await screen.findByRole('region', { name: /paddington/i })
}

describe("a Title's History", () => {
  it('says how many events the Title has and what the last one was, and lists them when opened', async () => {
    server.use(
      http.get('/events', ({ response }) =>
        response(200).json({ items: [event(2, 'grab', 'Sent Paddington.2014.1080p-GRP to the download client', 120), event(1, 'request', 'Ellie asked for Paddington', 600)] }),
      ),
    )
    const pane = await openPaddington()

    const toggle = await within(pane).findByRole('button', { name: 'History · 2 events, last: Grabbed 2 h ago' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)

    const history = within(pane).getByRole('region', { name: 'History' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(history).getAllByRole('listitem')).toHaveLength(3) // the two events and the way to the Log
    expect(within(history).getByRole('button', { name: 'Show in Log' })).toBeInTheDocument()
  })

  it('is left out while the Title has no events', async () => {
    const pane = await openPaddington()

    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).queryByRole('region', { name: 'History' })).not.toBeInTheDocument()
  })
})
