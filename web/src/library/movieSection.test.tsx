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
  video_codec: 'H.264',
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

const card = async (pane: HTMLElement, name = 'Standard') => within(await within(pane).findByRole('list', { name: 'Versions' })).findByRole('listitem', { name })

describe("a Movie's Versions on its Title page", () => {
  it('has a card per Slot saying the Slot and Profile, what it holds, its file name, its size and its actions', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    asFilled(r)
    const pane = await openPaddington()

    const versions = await within(pane).findByRole('region', { name: 'Versions' })
    expect(within(versions).getByRole('heading', { name: 'Versions' })).toBeInTheDocument()
    const item = await card(pane)
    expect(item).toHaveTextContent('Standard')
    expect(item).toHaveTextContent('WEB-DL 1080p')
    expect(item).toHaveTextContent('H.264')
    expect(item).toHaveTextContent('1.6 GB')
    expect(within(item).getByText(/Paddington \(2014\)/)).toHaveAttribute('title', file.path)
    expect(within(item).getByRole('button', { name: 'Search for Upgrade' })).toBeEnabled()
    await userEvent.click(within(item).getByRole('button', { name: 'Standard Actions' }))
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Manual Search…', 'File Details…', 'Switch Profile…HD', 'Show in Log', 'Delete Files…', 'Remove Version…'])
  })

  it('opens File Details… from the menu with the file’s facts', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    asFilled(r)
    const pane = await openPaddington()
    const item = await card(pane)

    await userEvent.click(within(item).getByRole('button', { name: 'Standard Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'File Details…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Standard File Details' }))
    for (const k of ['Quality', 'Video', 'Audio', 'Custom Format Score', 'Size', 'Path']) expect(dialog.getByText(k)).toBeInTheDocument()
    expect(dialog.getByText('+100')).toBeInTheDocument()
  })

  it('shows a Wanted Slot as its state and last search, with Search Now as its action', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', file: null, wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openPaddington()

    const item = await card(pane)
    expect(item).toHaveTextContent('Wanted 12 days')
    expect(within(item).getByText('No file yet')).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Search Now' })).toBeEnabled()
    expect(within(item).queryByRole('button', { name: 'Search for Upgrade' })).toBeNull()
  })

  it('shows a downloading Slot as its progress, with Open in Activity as its action and Cancel in its menu', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 1, slot: 'standard' })])
    const pane = await openPaddington()

    const item = await card(pane)
    await within(item).findByText(/Downloading 75%/)
    expect(item).toHaveTextContent('2 min left')
    expect(within(item).getByRole('button', { name: 'Open in Activity' })).toBeInTheDocument()
    await userEvent.click(within(item).getByRole('button', { name: 'Standard Actions' }))
    const names = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(names).toEqual(expect.arrayContaining(['Cancel Download', 'Cancel and Blocklist']))
  })

  it('shows Search Now, disabled, on a Slot of a Movie that is not monitored', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => response(200).json({ ...detail(r), monitored: false, versions: detail(r).versions.map((v) => ({ ...v, state: 'unmonitored', file: null })) })),
    )
    const pane = await openPaddington()
    const item = await card(pane)
    expect(await within(item).findByRole('button', { name: 'Search Now' })).toBeDisabled()
  })

  it('offers Add Version while the Movie has a free Slot', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const pane = await openPaddington()
    await userEvent.click(await within(pane).findByRole('button', { name: 'Add Version' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
