import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const rows = () => [
  row(1, 'Paddington', 'Ein Bär namens Paddington', {
    slots: {
      sd: null,
      hd: { version_id: 11, profile: 'kids-primary', state: 'wanted', long_missing: false },
      uhd: { version_id: 12, profile: 'uhd-primary', state: 'filled', long_missing: false },
    },
  }),
  row(2, 'Heat', 'Heat', { year: 1995 }),
  row(3, 'Zodiac', 'Zodiac', { year: 2007 }),
]

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

const selected = () => screen.getByRole('option', { selected: true })

describe('the Library list', () => {
  it('shows the English title, the Primary-Language title and a dot per Slot', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()

    const first = await within(list).findByRole('option', { name: /paddington/i })
    expect(first).toHaveTextContent('Paddington')
    expect(first).toHaveTextContent('Ein Bär namens Paddington')
    expect(within(first).getByRole('img', { name: 'SD: no Version' })).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: 'HD: wanted' })).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: 'UHD: filled' })).toBeInTheDocument()

    // The second line is only for a Primary-Language title that differs.
    const heat = within(list).getByRole('option', { name: /heat/i })
    expect(heat.querySelectorAll('[data-primary-title]')).toHaveLength(0)
  })

  it('is driven by j and k, the arrow keys and Enter', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(selected()).toHaveTextContent('Paddington')

    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('Heat')
    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('j') // clamped at the end
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('k')
    expect(selected()).toHaveTextContent('Heat')
    await userEvent.keyboard('{ArrowUp}')
    expect(selected()).toHaveTextContent('Paddington')
    await userEvent.keyboard('k') // clamped at the start
    expect(selected()).toHaveTextContent('Paddington')

    // Enter moves into the detail pane, Escape back to the list.
    await userEvent.keyboard('{Enter}')
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(pane).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(list).toHaveFocus()
    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('Heat')
  })

  it('filters from the keyboard: / focuses the filter, arrows keep moving, Escape clears it', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')

    await userEvent.keyboard('/')
    const filter = screen.getByRole('textbox', { name: /filter/i })
    expect(filter).toHaveFocus()
    await userEvent.keyboard('o') // Heat has no o; Paddington and Zodiac do
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('{Escape}')
    expect(filter).toHaveValue('')
    expect(within(list).getAllByRole('option')).toHaveLength(3)
    expect(list).toHaveFocus()
  })

  it('filters by the Primary-Language title too', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    await userEvent.type(screen.getByRole('textbox', { name: /filter/i }), 'bär')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(selected()).toHaveTextContent('Paddington')
  })

  it('says so when the Library is empty and offers to add', async () => {
    fakeLibrary([])
    await openLibrary()
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add a title/i }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
  })
})

describe('the Library detail pane', () => {
  it('shows the SD | HD | UHD Versions strip with Profile and status', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })

    expect(await within(pane).findByRole('heading', { name: 'Paddington' })).toBeInTheDocument()
    expect(pane).toHaveTextContent('Ein Bär namens Paddington')
    const sd = within(pane).getByRole('group', { name: 'SD' })
    const hd = within(pane).getByRole('group', { name: 'HD' })
    const uhd = within(pane).getByRole('group', { name: 'UHD' })
    expect(sd).toHaveTextContent('No Version')
    expect(await within(hd).findByText('Kids')).toBeInTheDocument() // the Profile's name arrives with GET /profiles
    expect(hd).toHaveTextContent('Wanted')
    expect(uhd).toHaveTextContent('UHD')
    expect(uhd).toHaveTextContent('Filled')
  })

  it('follows the selection', async () => {
    fakeLibrary(rows())
    await openLibrary()
    await screen.findByRole('heading', { name: 'Paddington' })
    await userEvent.keyboard('j')
    expect(await screen.findByRole('heading', { name: 'Heat' })).toBeInTheDocument()
  })

  it('shows the poster when the Title has one', async () => {
    fakeLibrary(rows())
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(rows()[0], { has_poster: true }))))
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(await within(pane).findByRole('img', { name: /poster/i })).toHaveAttribute('src', expect.stringContaining('/titles/1/poster'))
  })
})
