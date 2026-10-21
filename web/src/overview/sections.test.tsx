import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeQueue, queueItem } from '../test/queue'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const downloads = (n: number) => Array.from({ length: n }, (_, i) => queueItem({ grab_id: i + 1, release_name: `Grab.${i + 1}-GRP` }))

describe('Overview sections', () => {
  it('shows the first five downloads, the count in the heading and a link to Activity', async () => {
    fakeQueue(downloads(7))
    renderApp()

    await screen.findByText('Grab.1-GRP')
    const section = screen.getByRole('region', { name: 'Downloading now · 7' })
    const rows = within(section).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Grab.${n}-GRP`)))

    await userEvent.click(within(section).getByRole('button', { name: 'View all 7 →' }))
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('')
  })
})
