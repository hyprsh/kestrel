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
  path: '/data/media/movies/Paddington (2014)/Paddington (2014) - [Standard][WEBDL-1080p].mkv',
  size: 1.6 * 1024 ** 3,
  release_name: 'Paddington.2014.1080p.WEB-DL',
  score: 100,
  quality: 'WEBDL-1080p',
  languages: ['English'],
  imported_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
}

const asFilled = (r: ReturnType<typeof row>) =>
  server.use(
    http.get('/titles/{id}', ({ response }) => {
      const d = detail(r)
      return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
    }),
  )

describe("a Movie's Files table on its Title page", () => {
  it('has a row per Slot with the columns Slot, File, Quality, Size, Imported and the actions, and the menu on it', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    const pane = await openPaddington()

    const table = await within(pane).findByRole('table', { name: 'Movie' })
    expect(within(within(pane).getByRole('region', { name: 'Files' })).getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Slot', 'File', 'Quality', 'Size', 'Imported', 'Actions'])
    await userEvent.click(within(table).getByRole('button', { name: 'Standard file actions' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Manual search Standard…' })).toBeInTheDocument()
  })

  it('names a filled Slot by its file, with the release under it, the quality, size and date, and opens File details', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    asFilled(r)
    const pane = await openPaddington()

    const name = await within(pane).findByText('Paddington (2014) - [Standard][WEBDL-1080p].mkv')
    expect(name.closest('[title]')).toHaveAttribute('title', file.path)
    expect(within(pane).getByText('from Paddington.2014.1080p.WEB-DL')).toBeInTheDocument()
    expect(within(pane).getByText('WEB-DL 1080p')).toBeInTheDocument()
    expect(within(pane).getByText('1.6 GB')).toBeInTheDocument()
    await userEvent.click(within(pane).getByRole('button', { name: 'Standard file details' }))
    const pop = await screen.findByRole('dialog', { name: 'Standard file' })
    expect(pop).toHaveTextContent(file.path)
  })

  it('says why a Wanted Slot has no file, with Search now in place of File details', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', file: null, wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openPaddington()

    expect(await within(pane).findByText('No file yet')).toBeInTheDocument()
    expect(within(pane).getByText(/^Wanted 12 days · not searched yet$/)).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Search for the Standard file now' })).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Standard file details' })).toBeNull()
    expect(within(pane).getByTitle('Standard: Wanted 12 days')).toBeInTheDocument() // the header's chip
  })

  it('shows a downloading Slot as percent and time left', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 1, slot: 'standard' })])
    const pane = await openPaddington()

    expect(await within(pane).findByText('75% · 2 min')).toBeInTheDocument()
  })
})
