import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Event = components['schemas']['Event']
type Blocked = components['schemas']['BlocklistEntry']

const event = (id: number, kind: string, message: string, routine = false): Event => ({
  id,
  at: '2026-10-17T12:00:00Z',
  kind,
  routine,
  title_id: null,
  version_id: null,
  episode_id: null,
  grab_id: null,
  request_id: null,
  message,
  data: null,
})

const blocked: Blocked = {
  id: 7,
  release_name: 'Paddington.2014.1080p.BluRay.x264-BAD',
  indexer_id: 1,
  reason: 'canceled and blocklisted',
  size: 1,
  published_at: '2026-10-17T12:00:00Z',
  created_at: '2026-10-17T12:00:00Z',
  title_id: null,
  grab_id: null,
}

async function openLog() {
  const user = userEvent.setup()
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await user.click(await screen.findByRole('button', { name: 'Log' }))
  return user
}

describe('Log', () => {
  it('asks for the filters chosen and for routine events only when toggled', async () => {
    const queries: string[] = []
    server.use(
      http.get('/events', ({ request, response }) => {
        queries.push(new URL(request.url).search)
        return response(200).json({ items: [event(2, 'grab', 'Sent Paddington to the download client'), event(1, 'import', 'Imported Paddington')] })
      }),
    )
    const user = await openLog()

    const list = await screen.findByRole('list', { name: 'Events' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(queries.at(-1)).toBe('')

    await user.selectOptions(screen.getByLabelText('Slot'), 'hd')
    await user.selectOptions(screen.getByLabelText('Kind'), 'grab')
    await user.click(screen.getByLabelText('Show routine'))

    await screen.findByRole('list', { name: 'Events' })
    await expect.poll(() => queries.at(-1)).toContain('routine=true')
    expect(queries.at(-1)).toContain('slot=hd')
    expect(queries.at(-1)).toContain('kind=grab')
  })

  it('removes a Blocklist entry from the Blocklist view', async () => {
    let items = [blocked]
    server.use(
      http.get('/blocklist', ({ response }) => response(200).json({ items })),
      http.delete('/blocklist/{id}', ({ response }) => {
        items = []
        return response(204).empty()
      }),
    )
    const user = await openLog()
    await user.click(screen.getByRole('tab', { name: 'Blocklist' }))

    await user.click(await screen.findByRole('button', { name: /remove paddington.*bad/i }))

    expect(await screen.findByText('The Blocklist is empty.')).toBeInTheDocument()
  })
})
