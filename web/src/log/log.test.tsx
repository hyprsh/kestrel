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

/** Every query the Log sent, as search params, and the events it answers with. */
function events(items: Event[] = [event(2, 'grab', 'Sent Paddington to the download client'), event(1, 'import', 'Imported Paddington')]) {
  const sent: URLSearchParams[] = []
  server.use(
    http.get('/events', ({ request, response }) => {
      sent.push(new URL(request.url).searchParams)
      return response(200).json({ items })
    }),
  )
  return sent
}

const filter = () => screen.getByRole('combobox', { name: 'Filter the Log' })

describe('Log', () => {
  it('sends the qualifiers typed as filters: several kinds, a Slot and routine events', async () => {
    const sent = events()
    const user = await openLog()

    const list = await screen.findByRole('list', { name: 'Events' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(sent.at(-1)?.toString()).toBe('')

    await user.type(filter(), 'kind:grab_failed,import_rejected slot:4k routine:yes')

    await expect.poll(() => sent.at(-1)?.get('routine')).toBe('true')
    expect(sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import_rejected'])
    expect(sent.at(-1)?.getAll('slot')).toEqual(['4k'])
  })

  it('expands kind groups, sends excluded kinds apart, and finds Titles by name', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(2, 'Breaking Bad', 'Breaking Bad (2008)'), row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'kind:failures -kind:health_raised title:"breaking bad"')

    await expect.poll(() => sent.at(-1)?.getAll('title_id')).toEqual(['1', '2'])
    expect(sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import_rejected', 'import_stalled', 'blocklist', 'health_raised'])
    expect(sent.at(-1)?.getAll('exclude_kind')).toEqual(['health_raised'])
  })

  it('sends excluded Slots and Titles apart, and takes -routine:yes for routine:no', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), '-slot:4k -title:paddington -routine:no')

    await expect.poll(() => sent.at(-1)?.getAll('exclude_title_id')).toEqual(['3'])
    expect(sent.at(-1)?.getAll('exclude_slot')).toEqual(['4k'])
    expect(sent.at(-1)?.get('routine')).toBe('true')
    expect(sent.at(-1)?.has('slot')).toBe(false)
    expect(sent.at(-1)?.has('title_id')).toBe(false)

    await user.clear(filter())
    await user.type(filter(), 'routine:yes -routine:yes')
    await expect.poll(() => sent.at(-1)?.has('routine')).toBe(false)
  })

  it('shows nothing, without asking, for a Title the Library does not have', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'title:Heat')

    expect(await screen.findByText('Nothing in the Log matches.')).toBeInTheDocument()
    expect(sent.some((p) => p.has('title_id'))).toBe(false)
  })

  it('matches free text against the message and the Title name', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    events([{ ...event(2, 'grab', 'Sent a Release to SABnzbd'), title_id: 3 }, event(1, 'health_raised', 'The indexer is down')])
    const user = await openLog()
    const list = await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'paddington sab')

    await expect.poll(() => within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Sent a Release to SABnzbd')).toBeInTheDocument()
  })

  it('matches free text fuzzily, per word, newest first', async () => {
    fakeLibrary([row(3, 'Amélie', 'Amélie')])
    events([
      { ...event(3, 'import_rejected', 'Import rejected: no video file'), title_id: 3 },
      event(2, 'health_raised', 'The indexer is down'),
      { ...event(1, 'import_rejected', 'Import rejected: sample'), title_id: 3 },
    ])
    const user = await openLog()
    const list = await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'rejcted amelie')

    await expect.poll(() => within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('no video file'),
      expect.stringContaining('sample'),
    ])
  })

  it('suggests the values of the qualifier being typed, and Library Titles for title:', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(3, 'Paddington', 'Paddington')])
    events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'slot:')
    const options = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(within(options).getAllByRole('option').map((o) => o.textContent)).toEqual(['standard', '4k'])
    expect(filter()).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowDown}{Enter}')
    expect(filter()).toHaveValue('slot:4k')
    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).not.toBeInTheDocument()

    await user.type(filter(), ' title:bre')
    await user.click(screen.getByRole('option', { name: 'Breaking Bad' }))
    expect(filter()).toHaveValue('slot:4k title:"Breaking Bad"')
    expect(filter()).toHaveFocus()

    await user.type(filter(), ' kind:gr')
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).not.toBeInTheDocument()
    expect(filter()).toHaveFocus()
  })

  it('shows each qualifier as a removable chip, and adds a kind or a Title clicked in the list', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events([{ ...event(2, 'grab_failed', 'The download failed'), title_id: 3 }, event(1, 'import', 'Imported Heat')])
    const user = await openLog()
    const list = await screen.findByRole('list', { name: 'Events' })

    await user.click(within(list).getByRole('button', { name: 'Filter by kind:grab_failed' }))
    await user.click(await within(list).findByRole('button', { name: 'Filter by title:Paddington' }))
    await user.click(within(list).getByRole('button', { name: 'Filter by kind:import' }))
    expect(filter()).toHaveValue('kind:grab_failed,import title:Paddington')

    const chips = screen.getByRole('list', { name: 'Active filters' })
    expect(within(chips).getAllByRole('listitem').map((c) => c.textContent)).toEqual(['kind:grab_failed,import', 'title:Paddington'])
    await user.click(within(chips).getByRole('button', { name: 'Remove kind:grab_failed,import' }))
    expect(filter()).toHaveValue('title:Paddington')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toEqual([])
  })

  it('says why a qualifier was left out, once it is typed', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'slot:xl')
    expect(screen.queryByText('slot: takes standard or 4k, not “xl”')).not.toBeInTheDocument()
    await user.type(filter(), ' heat')
    expect(screen.getByRole('status')).toHaveTextContent('slot: takes standard or 4k, not “xl”')
  })

  it('lists the qualifiers in a help popover', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.click(screen.getByRole('button', { name: 'Filter help' }))
    const help = screen.getByRole('dialog', { name: 'Filter help' })
    expect(within(help).getByText('kind:')).toBeInTheDocument()
    expect(within(help).getByText('slot:')).toBeInTheDocument()
    expect(within(help).getByText('title:')).toBeInTheDocument()
    expect(within(help).getByText('routine:')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Filter help' })).not.toBeInTheDocument()
  })

  it('keeps the filter in the address bar, and leaves it there for the Log alone', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('list', { name: 'Events' })

    await user.type(filter(), 'kind:grab heat')
    expect(location.pathname).toBe('/log')
    expect(new URLSearchParams(location.search).get('q')).toBe('kind:grab heat')

    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(location.pathname + location.search).toBe('/')
  })

  it('opens a bookmarked, filtered Log', async () => {
    const sent = events()
    history.replaceState(null, '', '/log?q=slot%3A4k+heat')
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('slot:4k heat')
    await expect.poll(() => sent.at(-1)?.getAll('slot')).toEqual(['4k'])
  })

  it('opens from a Title page, filtered to that Title', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })
    await user.click(await within(pane).findByRole('button', { name: 'More Title actions' }))

    await user.click(screen.getByRole('menuitem', { name: 'Show in the Log' }))

    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('title:Paddington')
    await expect.poll(() => sent.at(-1)?.getAll('title_id')).toEqual(['3'])
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
