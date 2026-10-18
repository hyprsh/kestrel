import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Slots = components['schemas']['TitleRow']['slots']
const hd = (state: 'wanted' | 'filled', long = false): Slots => ({
  sd: null,
  hd: { version_id: 1, profile: 'hd-primary', state, long_missing: long },
  uhd: null,
})

const rows = () => [
  row(1, 'Filled Film', 'Filled Film', { slots: hd('filled'), wanted_since: null }),
  row(2, 'Recent Film', 'Recent Film', { slots: hd('wanted'), wanted_since: '2026-10-10T00:00:00Z' }),
  row(3, 'Ancient Film', 'Ancient Film', { slots: hd('wanted', true), wanted_since: '2026-01-01T00:00:00Z' }),
]

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

const names = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.textContent?.replace(/\d{4}$/, '').trim())

describe('the Wanted filter', () => {
  it('keeps the Titles with a Wanted Version and shows the Long Missing chip only then', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(screen.queryByRole('button', { name: 'Long Missing' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Wanted' }))
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(within(list).queryByRole('option', { name: /filled film/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Long Missing' }))
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByRole('option', { name: /ancient film/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Wanted' })) // off again; the chip goes with it
    expect(within(list).getAllByRole('option')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Long Missing' })).not.toBeInTheDocument()
  })

  it('sorts by Wanted since, the longest Wanted first and Titles that are not Wanted last', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(names(list)[0]).toMatch(/filled film/i) // the server's order

    await userEvent.click(screen.getByRole('button', { name: /sort by wanted since/i }))

    expect(names(list).map((n) => n?.replace(/\s*\d*$/, ''))).toEqual(['Ancient Film', 'Recent Film', 'Filled Film'])
  })
})

describe('Search all Wanted in the command menu', () => {
  it('posts to /wanted/search', async () => {
    fakeLibrary([])
    let posted = 0
    server.use(
      http.post('/wanted/search', ({ response }) => {
        posted++
        return response(202).json({ versions: 3 })
      }),
    )
    renderApp()
    await screen.findByRole('navigation')
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: /command menu/i })

    await userEvent.type(within(menu).getByRole('combobox'), 'search all')
    await userEvent.click(await within(menu).findByRole('option', { name: /search all wanted/i }))

    await waitFor(() => expect(posted).toBe(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
