import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'

async function openPaddington() {
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  await within(pane).findByRole('button', { name: 'Title actions' })
  return pane
}

const file = {
  path: '/data/media/movies/Paddington (2014)/Paddington.mkv',
  size: 1.6 * 1024 ** 3,
  release_name: 'Paddington.2014.1080p.WEB-DL',
  score: 100,
  quality: 'WEBDL-1080p',
  languages: ['English'],
  imported_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
}

describe("a Movie's Slot cells on its Title page", () => {
  it('show a filled Slot as resolution and size, with the episode cell’s tooltip, and open the file popover', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
      }),
    )
    const pane = await openPaddington()

    const cell = within(pane).getByRole('button', { name: 'Standard: Filled, 1080p · 1.6 GB' })
    expect(cell).toHaveTextContent('1080p · 1.6 GB')
    expect(cell).toHaveAttribute('title', `Standard: Filled · Score 100 · WEBDL-1080p · 1.6 GB\n${file.path}`)
    await userEvent.click(cell)
    const pop = await screen.findByRole('dialog', { name: 'Standard file' })
    expect(pop).toHaveTextContent(file.path)
    expect(within(pop).getByText('Paddington.2014.1080p.WEB-DL')).toBeInTheDocument()
  })

  it('show a Wanted Slot with its days, and the badges no longer repeat it', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openPaddington()

    const cell = within(pane).getByRole('button', { name: 'Standard: Wanted' })
    expect(cell).toHaveTextContent('Wanted · 12 d')
    expect(cell).toHaveAttribute('title', 'Standard: Wanted\nWanted · 12 d')
    expect(within(pane).queryByText('Standard Wanted · 12 days')).not.toBeInTheDocument()
  })

  it('show a downloading Slot as percent and time left', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 1, slot: 'standard' })])
    const pane = await openPaddington()

    const cell = await within(pane).findByRole('button', { name: 'Standard: Downloading, 75% · 2 min' })
    expect(cell).toHaveTextContent('75% · 2 min')
    expect(cell).toHaveAttribute('title', 'Standard: Downloading\n75% · 2 min')
  })
})
