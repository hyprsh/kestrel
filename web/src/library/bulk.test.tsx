import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const rows = () => [
  row(1, 'Paddington', 'Paddington', {
    size: 6 * 1024 ** 3,
    slots: {
      standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false },
      '4k': { version_id: 12, profile: '4k-primary', state: 'wanted', long_missing: false },
    },
  }),
  row(2, 'Heat', 'Heat', { year: 1995, size: 4 * 1024 ** 3 }),
  row(3, 'Zodiac', 'Zodiac', { year: 2007 }),
  row(4, 'Breaking Bad', 'Breaking Bad', { kind: 'series' }),
]

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const list = await screen.findByRole('listbox', { name: /library/i })
  await within(list).findAllByRole('option')
  return list
}

const box = (name: string) => screen.getByRole('checkbox', { name: `Tick ${name}` })

describe('selecting Titles in the Library', () => {
  it('ticks the Title under the cursor with x and clears the selection with Escape', async () => {
    fakeLibrary(rows())
    await openLibrary()

    await userEvent.keyboard('x')
    await userEvent.keyboard('j')
    await userEvent.keyboard('j')
    await userEvent.keyboard('x')

    expect(screen.getByText('2 ticked')).toBeInTheDocument()
    expect(box('Paddington')).toBeChecked()
    expect(box('Heat')).not.toBeChecked()
    expect(box('Zodiac')).toBeChecked()

    await userEvent.keyboard('x') // x again unticks
    expect(screen.getByText('1 ticked')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText(/ticked/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /tick/i })).not.toBeInTheDocument()
  })

  it('ticks a range with shift-click without moving the cursor', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tick' }))

    await user.click(box('Heat'))
    await user.keyboard('{Shift>}')
    await user.click(box('Breaking Bad'))
    await user.keyboard('{/Shift}')

    expect(screen.getByText('3 ticked')).toBeInTheDocument()
    expect(box('Paddington')).not.toBeChecked()
    expect(box('Zodiac')).toBeChecked()
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Paddington')
  })

  it('selects all the Titles the filter shows, and only those', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const filter = screen.getByRole('combobox', { name: 'Filter the Library' })
    await userEvent.type(filter, 'kind:series')
    await userEvent.click(screen.getByRole('button', { name: 'Tick' }))
    await userEvent.clear(filter)
    await userEvent.type(filter, 'kind:movie')

    await userEvent.click(screen.getByRole('button', { name: 'Tick all 3 shown' }))

    expect(screen.getByText('3 ticked')).toBeInTheDocument()
    await userEvent.clear(filter)
    expect(box('Breaking Bad')).not.toBeChecked()
    expect(screen.getByText('3 ticked')).toBeInTheDocument()
  })
})

type Outcome = components['schemas']['TitleBulkOutcome']

/** Answers POST /titles/bulk with `answer` and records the bodies sent. */
function fakeBulk(answer: (body: components['schemas']['TitlesBulk']) => Outcome[]) {
  const sent: components['schemas']['TitlesBulk'][] = []
  server.use(
    http.post('/titles/bulk', async ({ request, response }) => {
      const body = await request.clone().json()
      sent.push(body)
      return response(200).json({ items: answer(body) })
    }),
  )
  return sent
}

const changed = (id: number): Outcome => ({ title_id: id, outcome: 'changed', reason: null, message: null })
const skipped = (id: number, reason: Outcome['reason'], message: string): Outcome => ({ title_id: id, outcome: 'skipped', reason, message })

/** Opens the Library with the named Titles ticked and returns the actions pane. */
async function withTicked(...names: string[]) {
  await openLibrary()
  await userEvent.click(screen.getByRole('button', { name: 'Tick' }))
  for (const n of names) await userEvent.click(box(n))
  return screen.getByRole('region', { name: `${names.length} ${names.length === 1 ? 'Title' : 'Titles'} ticked` })
}

describe('changing the ticked Titles together', () => {
  it('unmonitors them in one call and says what changed', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk((b) => b.title_ids.map(changed))
    const pane = await withTicked('Paddington', 'Breaking Bad')

    await userEvent.click(within(pane).getByRole('button', { name: 'Unmonitor' }))

    expect(await findToast('Unmonitor: 2 changed')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'monitor', monitored: false, title_ids: [1, 4] }])
  })

  it('monitors them with a mode for the Series and says which were already monitored', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk(({ title_ids: [movie, series] }) => [changed(movie), skipped(series, 'unchanged', 'Already as asked')])
    const pane = await withTicked('Paddington', 'Breaking Bad')

    await userEvent.click(within(pane).getByRole('button', { name: 'Monitor' }))
    await userEvent.selectOptions(within(pane).getByRole('combobox', { name: 'Series monitor' }), 'Future episodes')
    await userEvent.click(within(pane).getByRole('button', { name: 'Apply' }))

    expect(await findToast('Monitor: 1 changed; 1 already as asked')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'monitor', monitored: true, series_monitor: 'future', title_ids: [1, 4] }])
  })

  it('monitors Movies at once: there is no mode to pick', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk((b) => b.title_ids.map(changed))
    const pane = await withTicked('Paddington', 'Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Monitor' }))

    expect(await findToast('Monitor: 2 changed')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'monitor', monitored: true, title_ids: [1, 2] }])
  })

  it('switches the Profile of one Slot and counts the Titles without a Version there', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk(({ title_ids: [first, ...rest] }) => [changed(first), ...rest.map((id) => skipped(id, 'no_version', 'Has no 4K Version'))])
    const pane = await withTicked('Paddington', 'Heat', 'Zodiac')

    await userEvent.click(within(pane).getByRole('button', { name: 'Switch Profile' }))
    const form = within(pane).getByRole('group', { name: 'Switch Profile' })
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Slot' }), '4K')
    await userEvent.selectOptions(await within(form).findByRole('combobox', { name: 'Profile' }), '4K')
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }))

    expect(await findToast('Switch Profile: 1 changed; 2 have no 4K Version')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'switch_profile', slot: '4k', profile: '4k-primary', title_ids: [1, 2, 3] }])
  })

  it('adds a Version to an empty Slot under the default Profile and counts the taken Slots', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk(({ title_ids: [first, ...rest] }) => [skipped(first, 'slot_taken', 'Already has a Standard Version'), ...rest.map(changed)])
    const pane = await withTicked('Paddington', 'Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Add Version' }))
    const form = within(pane).getByRole('group', { name: 'Add Version' })
    expect(await within(form).findByRole('combobox', { name: 'Profile' })).toHaveDisplayValue('HD')
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }))

    expect(await findToast('Add Version: 1 changed; 1 already has a Standard Version')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'add_version', slot: 'standard', profile: 'hd-primary', title_ids: [1, 2] }])
  })

  it('removes the Version in a Slot, keeping files unless asked', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk((b) => b.title_ids.map(changed))
    const pane = await withTicked('Paddington', 'Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Remove Version' }))
    const form = screen.getByRole('alertdialog', { name: 'Remove Version' })
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Slot' }), '4K')
    expect(within(form).getByRole('checkbox', { name: 'Also delete files' })).not.toBeChecked()
    await userEvent.click(within(form).getByRole('button', { name: 'Remove' }))

    expect(await findToast('Remove Version: 2 changed')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'remove_version', slot: '4k', delete_files: false, title_ids: [1, 2] }])
  })

  it('removes them from the Library after saying how many and how much is on disk', async () => {
    fakeLibrary(rows())
    const sent = fakeBulk((b) => b.title_ids.map(changed))
    const pane = await withTicked('Paddington', 'Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Remove from Library' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Titles' })
    expect(confirm).toHaveTextContent('Remove 2 Titles from the Library, with 10.0 GB of files.')
    await userEvent.click(within(confirm).getByRole('checkbox', { name: 'Also delete files' }))
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))

    expect(await findToast('Remove from Library: 2 changed')).toBeInTheDocument()
    expect(sent).toEqual([{ action: 'remove', delete_files: true, title_ids: [1, 2] }])
  })

  it('says why the call failed', async () => {
    fakeLibrary(rows())
    server.use(
      http.post('/titles/bulk', ({ response }) => response(422).json({ type: 'about:blank', title: 'unprocessable entity', status: 422, code: 'validation', detail: 'That Profile is disabled' })),
    )
    const pane = await withTicked('Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Search now' }))

    expect(await findToast('Search now failed: That Profile is disabled')).toBeInTheDocument()
  })

  it('says why Remove Version and Remove from Library failed, and closes the dialog on confirm', async () => {
    fakeLibrary(rows())
    server.use(
      http.post('/titles/bulk', ({ response }) => response('default').json({ type: 'about:blank', title: 'internal', status: 500, code: 'internal', detail: 'database locked' }, { status: 500 })),
    )
    const pane = await withTicked('Paddington', 'Heat')

    await userEvent.click(within(pane).getByRole('button', { name: 'Remove Version' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Remove Version' })).getByRole('button', { name: 'Remove' }))
    expect(await findToast('Remove Version failed: database locked')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await userEvent.click(within(pane).getByRole('button', { name: 'Remove from Library' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Remove Titles' })).getByRole('button', { name: 'Remove' }))
    expect(await findToast('Remove from Library failed: database locked')).toBeInTheDocument()
  })

  it.each([
    ['Search now', { action: 'search' }],
    ['Refresh metadata', { action: 'refresh' }],
    ['Freeze metadata', { action: 'freeze', frozen: true }],
    ['Unfreeze metadata', { action: 'freeze', frozen: false }],
  ])('runs %s at once', async (label, body) => {
    fakeLibrary(rows())
    const sent = fakeBulk((b) => b.title_ids.map(changed))
    const pane = await withTicked('Heat', 'Zodiac')

    await userEvent.click(within(pane).getByRole('button', { name: label }))

    expect(await findToast(label === 'Search now' ? 'Search started for 2 Titles' : `${label}: 2 changed`)).toBeInTheDocument()
    expect(sent).toEqual([{ ...body, title_ids: [2, 3] }])
  })
})
