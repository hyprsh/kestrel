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

    const toggle = await within(pane).findByRole('button', { name: /^History · 2 events · last: Grabbed.*, 2 h ago$/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const history0 = within(pane).getByRole('region', { name: 'History' })
    expect(within(history0).queryByRole('list')).not.toBeInTheDocument() // collapsed to start with
    expect(within(history0).getByRole('button', { name: 'Open in Log' })).toBeInTheDocument()
    await userEvent.click(toggle)

    const history = within(pane).getByRole('region', { name: 'History' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(history).getAllByRole('listitem')).toHaveLength(3) // the two events and the way to the Log
    expect(within(history).getByRole('button', { name: 'Show all 2 events in the Log' })).toBeInTheDocument()
  })

  it('names the whole age of the last event, minutes included', async () => {
    server.use(
      http.get('/events', ({ response }) => response(200).json({ items: [event(2, 'import', 'Imported Paddington.2014.1080p-GRP', 238), event(1, 'request', 'Ellie asked for Paddington', 600)] })),
    )
    const pane = await openPaddington()

    expect(await within(pane).findByRole('button', { name: /last: Imported.*, 3 h 58 min ago$/ })).toBeInTheDocument()
  })

  it("shows each entry's trigger and reason, and leaves out what an old entry lacks", async () => {
    server.use(
      http.get('/events', ({ response }) =>
        response(200).json({
          items: [
            { ...event(3, 'search', 'Searched in Standard: nothing to grab', 5), trigger: { kind: 'sweep', actor: null, via: null }, reason: 'due: 3 days after it became Wanted' },
            { ...event(2, 'monitoring', 'Monitoring turned off', 60), trigger: { kind: 'person', actor: 'Navi', via: 'updateTitle' }, reason: 'chosen by hand: monitoring was changed' },
            event(1, 'request', 'Ellie asked for Paddington', 600),
          ],
        }),
      ),
    )
    const pane = await openPaddington()

    await userEvent.click(await within(pane).findByRole('button', { name: /^History/ }))

    const history = within(pane).getByRole('region', { name: 'History' })
    expect(within(history).getByText('The search sweep · due: 3 days after it became Wanted')).toBeInTheDocument()
    expect(within(history).getByText('Navi · update title · chosen by hand: monitoring was changed')).toBeInTheDocument()
    expect(within(history).getAllByRole('listitem')).toHaveLength(4)
  })

  it('is left out while the Title has no events', async () => {
    const pane = await openPaddington()

    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).queryByRole('region', { name: 'History' })).not.toBeInTheDocument()
  })
})
