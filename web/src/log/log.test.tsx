import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'
import { chooseTitleItem } from '../test/titleHeader'
import { findToast } from '../test/toasts'

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

/** The rows of the Events table without its header row. */
const eventRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1)

const filter = () => screen.getByRole('combobox', { name: 'Filter the Log' })

describe('Log', () => {
  it('sends the qualifiers typed as filters: several kinds, a Slot and routine events', async () => {
    const sent = events()
    const user = await openLog()

    const list = await screen.findByRole('table', { name: 'Events' })
    expect(eventRows(list)).toHaveLength(2)
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
    await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'kind:failures -kind:health_raised title:"breaking bad"')

    await expect.poll(() => sent.at(-1)?.getAll('title_id')).toEqual(['1', '2'])
    // The old group `failures` is Errors plus Warnings.
    expect(sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import_rejected', 'blocklist', 'import_stalled', 'health_raised', 'original_offered'])
    expect(sent.at(-1)?.getAll('exclude_kind')).toEqual(['health_raised'])
  })

  it('sends excluded Slots and Titles apart, and takes -routine:yes for routine:no', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

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

  it('pages 50 events at a time, keeps the page in the address bar and goes back to page 1 when the filter changes', async () => {
    events(Array.from({ length: 120 }, (_, i) => event(i + 1, 'import', `Imported #${i + 1}`)))
    const user = await openLog()
    const table = await screen.findByRole('table', { name: 'Events' })
    expect(eventRows(table)).toHaveLength(50)
    expect(screen.getByText('1–50 of 120')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next Page' }))
    expect(location.search).toBe('?page=2')
    expect(eventRows(table)[0]).toHaveTextContent('Imported #51')
    await user.click(screen.getByRole('button', { name: 'Next Page' }))
    expect(eventRows(table)).toHaveLength(20)

    await user.type(filter(), 'imp')
    expect(location.search).not.toContain('page=')
    expect(location.search).toContain('q=imp')
    expect(await screen.findByText('1–50 of 120')).toBeInTheDocument()
  })

  it('opens on the page named in the address bar', async () => {
    history.replaceState(null, '', '/log?page=3')
    events(Array.from({ length: 120 }, (_, i) => event(i + 1, 'import', `Imported #${i + 1}`)))
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

    expect(await screen.findByText('101–120 of 120')).toBeInTheDocument()
    expect(eventRows(screen.getByRole('table', { name: 'Events' }))).toHaveLength(20)
    expect(screen.getByText('101–120 of 120')).toBeInTheDocument()
  })

  it('shows nothing, without asking, for a Title the Library does not have', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'title:Heat')

    expect(await screen.findByText('Nothing in the Log matches.')).toBeInTheDocument()
    expect(sent.some((p) => p.has('title_id'))).toBe(false)
  })

  it('matches free text against the message and the Title name', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    events([{ ...event(2, 'grab', 'Sent a Release to SABnzbd'), title_id: 3 }, event(1, 'health_raised', 'The indexer is down')])
    const user = await openLog()
    const list = await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'paddington sab')

    await expect.poll(() => eventRows(list)).toHaveLength(1)
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
    const list = await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'rejcted amelie')

    await expect.poll(() => eventRows(list)).toHaveLength(2)
    expect(eventRows(list).map((row) => row.textContent)).toEqual([expect.stringContaining('no video file'), expect.stringContaining('sample')])
  })

  it('suggests the values of the qualifier being typed, and Library Titles for title:', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(3, 'Paddington', 'Paddington')])
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'slot:')
    const options = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(
      within(options)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['standard', '4k'])
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

  it('shows an event\u2019s kind as a plain label, and filters by kind only from the Filter menu', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events([{ ...event(2, 'grab_failed', 'The download failed'), title_id: 3 }, event(1, 'import', 'Imported Heat')])
    const user = await openLog()
    const list = await screen.findByRole('table', { name: 'Events' })

    expect(within(list).getByText('Failed')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /^Filter by kind:/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Filter( ·|$)/ }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Failed' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Imported' }))
    expect(filter()).toHaveValue('kind:grab_failed,import')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import'])

    // Unticking a kind takes it out of the field.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Failed' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Failed' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Imported' }))
    expect(filter()).toHaveValue('')
  })

  it('adds the title filter when a Title name in an event is clicked', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    const sent = events([{ ...event(2, 'grab_failed', 'The download failed'), title_id: 3 }])
    const user = await openLog()
    const list = await screen.findByRole('table', { name: 'Events' })

    await user.click(await within(list).findByRole('button', { name: 'Filter by title:Paddington' }))

    expect(filter()).toHaveValue('title:Paddington')
    await expect.poll(() => sent.at(-1)?.getAll('title_id')).toEqual(['3'])
  })

  it('says why a qualifier was left out, once it is typed', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

    await user.type(filter(), 'slot:xl')
    expect(screen.queryByText('slot: takes standard or 4k, not “xl”')).not.toBeInTheDocument()
    await user.type(filter(), ' heat')
    expect(screen.getByRole('status')).toHaveTextContent('slot: takes standard or 4k, not “xl”')
  })

  it('lists the qualifiers in a help popover', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

    await user.click(screen.getByRole('button', { name: 'Query Help' }))
    const help = screen.getByRole('dialog', { name: 'Query Help' })
    expect(within(help).getByText('kind:')).toBeInTheDocument()
    expect(within(help).getByText('slot:')).toBeInTheDocument()
    expect(within(help).getByText('title:')).toBeInTheDocument()
    expect(within(help).getByText('routine:')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Query Help' })).not.toBeInTheDocument()
  })

  it('keeps the filter in the address bar, and leaves it there for the Log alone', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

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
    await chooseTitleItem(pane, 'Show in Log')

    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('title:Paddington')
    await expect.poll(() => sent.at(-1)?.getAll('title_id')).toEqual(['3'])
  })

  it('keeps Reset column widths in the Log actions menu, and gives the Blocklist no filter row', async () => {
    events()
    localStorage.setItem('kestrel.columns.log', JSON.stringify({ when: 200 }))
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })

    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reset column widths' }))
    expect(localStorage.getItem('kestrel.columns.log')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    expect(screen.getByRole('menuitem', { name: 'Reset column widths' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Blocklist' }))
    expect(screen.queryByRole('combobox', { name: 'Filter the Log' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    expect(screen.getByRole('menuitem', { name: 'Back to the Log' })).toBeInTheDocument()
  })

  it('sets the filter from a view, marks the current one and counts each from the summary', async () => {
    const sent = events()
    server.use(
      http.get('/events/summary', ({ response }) =>
        response(200).json({
          counts: [
            { kind: 'grab', count: 4, routine: false },
            { kind: 'grab_completed', count: 9, routine: true },
            { kind: 'grab_failed', count: 2, routine: false },
            { kind: 'import', count: 3, routine: false },
            { kind: 'adoption', count: 5, routine: false },
            { kind: 'search', count: 7, routine: true },
          ],
          oldest: '2026-10-10T12:00:00Z',
          routine_days: 30,
        }),
      ),
    )
    const user = await openLog()
    const views = await screen.findByRole('navigation', { name: 'Views' })
    expect(await within(views).findByRole('button', { name: /^Everything\W*14$/ })).toHaveAttribute('aria-current', 'true')
    expect(within(views).getByRole('button', { name: /^Errors\W*2$/ })).toBeInTheDocument()
    expect(within(views).getByRole('button', { name: /^Grabs\W*6$/ })).toBeInTheDocument()
    expect(within(views).getByRole('button', { name: /^Adoption\W*5$/ })).toBeInTheDocument()
    expect(within(views).getByRole('button', { name: /^Searches\W*7$/ })).toBeInTheDocument()
    expect(
      within(views)
        .getAllByRole('button')
        .map((b) => b.textContent?.replace(/\W*\d+$/, '')),
    ).toEqual(['Everything', 'Errors', 'Warnings', 'Grabs', 'Imports', 'Adoption', 'Searches'])
    expect(screen.getByText(/Last \d+ days · routine kept 30 days/)).toBeInTheDocument()

    await user.click(within(views).getByRole('button', { name: /^Errors\W*2$/ }))
    expect(screen.getByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:errors')
    expect(within(views).getByRole('button', { name: /^Errors\W*2$/ })).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import_rejected', 'blocklist'])

    await user.click(within(views).getByRole('button', { name: /^Searches\W*7$/ }))
    expect(screen.getByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:search routine:yes')
    await expect.poll(() => sent.at(-1)?.get('routine')).toBe('true')

    await user.click(within(views).getByRole('button', { name: /^Everything\W*14$/ }))
    expect(screen.getByRole('combobox', { name: 'Filter the Log' })).toHaveValue('')
  })

  it('keeps the Filter menu to refinements: single kinds, Slots and routine events, never Views, Titles or Failures', async () => {
    fakeLibrary([row(1, 'Breaking Bad', 'Breaking Bad'), row(3, 'Paddington', 'Paddington')])
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })
    const views = await screen.findByRole('navigation', { name: 'Views' })

    await user.click(screen.getByRole('button', { name: /^Filter( ·|$)/ }))
    const menu = await screen.findByRole('menu')
    const items = within(menu)
      .getAllByRole('menuitemcheckbox')
      .map((i) => i.textContent)
    expect(items).toContain('Grabbed')
    expect(items).toContain('Downloaded')
    expect(items).toContain('Show routine events')
    for (const gone of ['Grabs', 'Imports', 'Adoption', 'Errors', 'Warnings', 'Failures', 'Breaking Bad', 'Paddington']) expect(items).not.toContain(gone)
    expect(within(menu).queryByText('Title')).not.toBeInTheDocument()
    expect(within(menu).getByText('Slot')).toBeInTheDocument()

    // A single kind is none of the Views, and Everything is no longer current; it is one refinement.
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Grabbed' }))
    expect(filter()).toHaveValue('kind:grab')
    expect(within(views).getByRole('button', { name: /^Everything/ })).not.toHaveAttribute('aria-current')
    expect(within(views).queryByRole('button', { current: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
  })

  it('keeps a View marked while it is refined, and counts only the refinements on Filter', async () => {
    events()
    const user = await openLog()
    await screen.findByRole('table', { name: 'Events' })
    const views = await screen.findByRole('navigation', { name: 'Views' })

    await user.click(within(views).getByRole('button', { name: /^Errors/ }))
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    await user.type(filter(), ' slot:4k')
    expect(within(views).getByRole('button', { name: /^Errors/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
    await user.type(filter(), ' title:Heat')
    expect(within(views).getByRole('button', { name: /^Errors/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
  })

  it('turns the Log round with the Sort button', async () => {
    events()
    const user = await openLog()
    expect(await screen.findAllByRole('row')).toHaveLength(3)
    const rows = () => screen.getAllByRole('row').map((r) => r.textContent)
    expect(rows()[1]).toContain('Sent Paddington')
    await user.click(screen.getByRole('button', { name: 'Sort: Newest first' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Oldest first' }))
    expect(rows()[1]).toContain('Imported Paddington')
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
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Blocklist' }))

    await user.click(await screen.findByRole('button', { name: /remove paddington.*bad/i }))

    expect(await screen.findByText('The Blocklist is empty.')).toBeInTheDocument()
    expect(await findToast('Release removed from the Blocklist')).toBeInTheDocument()
  })

  it('says in a Toast when a Blocklist entry could not be removed', async () => {
    server.use(
      http.get('/blocklist', ({ response }) => response(200).json({ items: [blocked] })),
      http.delete('/blocklist/{id}', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'database locked' }, { status: 500 })),
    )
    const user = await openLog()
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Blocklist' }))

    await user.click(await screen.findByRole('button', { name: /remove paddington.*bad/i }))

    expect(await findToast('Could not remove the Release from the Blocklist: database locked')).toBeInTheDocument()
  })
})

describe('Log on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    history.replaceState(null, '', '/')
  })
  afterEach(() => vi.unstubAllGlobals())

  async function openPhoneLog() {
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Log' }))
    return user
  }

  it('stacks each event as a row with its kind, time and message, and the kind is a label', async () => {
    events()
    await openPhoneLog()

    const list = await screen.findByRole('list', { name: 'Events' })
    expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Events' })).not.toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Imported Paddington')).toBeInTheDocument()

    expect(within(list).getByText('Imported')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /^Filter by kind:/ })).not.toBeInTheDocument()
  })

  it('lists the Blocklist as stacked entries with a button to remove each', async () => {
    let items = [blocked]
    server.use(
      http.get('/blocklist', ({ response }) => response(200).json({ items })),
      http.delete('/blocklist/{id}', ({ response }) => {
        items = []
        return response(204).empty()
      }),
    )
    events()
    const user = await openPhoneLog()
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Blocklist' }))
    const list = await screen.findByRole('list', { name: 'Blocklist' })
    expect(within(list).getByText(blocked.release_name)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /remove paddington.*bad/i }))
    expect(await screen.findByText('The Blocklist is empty.')).toBeInTheDocument()
  })

  it('reaches the Views from the Log actions menu', async () => {
    const sent = events()
    const user = await openPhoneLog()
    await screen.findByRole('list', { name: 'Events' })
    await user.click(screen.getByRole('button', { name: 'Log actions' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Grabs' }))
    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:grabs')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toContain('grab')
  })
})
