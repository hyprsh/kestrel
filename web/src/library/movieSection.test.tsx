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

describe("a Movie's Versions on its Title page", () => {
  it('has a row per Slot in an accordion, closed rows saying the Slot, its state, its file and its size', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    asFilled(r)
    const pane = await openPaddington()

    const versions = await within(pane).findByRole('region', { name: 'Versions' })
    expect(within(versions).getByRole('heading', { name: 'Versions' })).toBeInTheDocument()
    const row_ = within(versions).getByRole('button', { name: 'Standard: Have · WEB-DL 1080p' })
    expect(row_).toHaveAttribute('aria-expanded', 'false') // every row starts closed
    const item = row_.closest('[role=listitem]') as HTMLElement
    expect(item).toHaveTextContent('Standard')
    expect(item).toHaveTextContent('WEB-DL 1080p')
    expect(item).not.toHaveTextContent('Have') // the chip says the state
    expect(item).toHaveTextContent('H.264') // the mono line: quality, codec and audio
    expect(item).toHaveTextContent('Imported') // the status chip
    expect(
      within(item)
        .getByText(/WEB-DL 1080p · H\.264/)
        .closest('[title]'),
    ).toHaveAttribute('title', file.path)
    expect(item).toHaveTextContent('1.6 GB')
    expect(within(item).getByRole('img', { name: /^Standard: Have/ })).toHaveAttribute('data-state', 'filled')
  })

  it('opens a filled Slot to its facts, with Search for Upgrade on its header and the rest in its menu', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    asFilled(r)
    const pane = await openPaddington()

    const row_ = await within(await within(pane).findByRole('region', { name: 'Versions' })).findByRole('button', { name: /^Standard: Have/ })
    expect(row_).toHaveAttribute('aria-expanded', 'false')
    const item = row_.closest('[role=listitem]') as HTMLElement
    expect(within(item).getByRole('button', { name: 'Search for Upgrade' })).toBeEnabled()
    await userEvent.click(row_)
    expect(row_).toHaveAttribute('aria-expanded', 'true')
    for (const k of ['Quality', 'Video', 'Audio', 'Custom Format Score', 'Size', 'Path']) expect(within(item).getByText(k)).toBeInTheDocument()
    expect(within(item).getAllByText('Imported')).toHaveLength(2) // the chip and the fact
    // Opened, the row keeps its header: the size and the file name show there and in the facts (the Path adds the folder).
    expect(within(item).getAllByText('1.6 GB')).toHaveLength(2)
    expect(within(item).getAllByText(/Paddington \(2014\)/)).toHaveLength(2)
    expect(within(item).getByText('Quality').nextSibling).not.toHaveTextContent('H.264')
    expect(within(item).getByText('+100')).toBeInTheDocument()
    expect(within(item).getAllByRole('button', { name: 'Search for Upgrade' })).toHaveLength(1) // the body has no action bar
    expect(within(item).queryByRole('button', { name: 'Manual Search' })).toBeNull()
    await userEvent.click(within(item).getByRole('button', { name: 'Standard Actions' }))
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Delete Files…', 'Remove Version…'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(row_)
    expect(row_).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a Wanted Slot to why it has no file, with Search Now on its header', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', file: null, wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openPaddington()

    const row_ = await within(await within(pane).findByRole('region', { name: 'Versions' })).findByRole('button', { name: /^Standard: Wanted 12 days/ })
    const item = row_.closest('[role=listitem]') as HTMLElement
    expect(within(item).getByText('No file yet')).toBeInTheDocument()
    expect(row_).toHaveAttribute('aria-expanded', 'false') // a Slot that needs a look stays closed too
    expect(within(item).getByRole('button', { name: 'Search Now' })).toBeEnabled()
    expect(within(item).queryByText('Wanted since')).toBeNull()
    await userEvent.click(row_)
    expect(within(item).getByText('Wanted since')).toBeInTheDocument()
    expect(within(item).getByText('not searched yet')).toBeInTheDocument()
    expect(within(item).getAllByRole('button', { name: 'Search Now' })).toHaveLength(1)
    expect(within(item).queryByRole('button', { name: 'Search for Upgrade' })).toBeNull()
    expect(within(item).getByRole('img', { name: /^Standard: Wanted 12 days/ })).toHaveAttribute('data-state', 'wanted')
  })

  it('opens a downloading Slot to its progress, with Open in Activity on its header and Cancel in its menu', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 1, slot: 'standard' })])
    const pane = await openPaddington()

    const row_ = await within(await within(pane).findByRole('region', { name: 'Versions' })).findByRole('button', { name: /^Standard: Downloading 75%/ })
    const item = row_.closest('[role=listitem]') as HTMLElement
    expect(item).toHaveTextContent('Downloading 75%') // the status chip
    expect(within(item).getByRole('button', { name: 'Open in Activity' })).toBeInTheDocument()
    expect(within(item).queryByRole('progressbar')).toBeNull()
    await userEvent.click(row_)
    expect(item).toHaveTextContent('2 min left') // the progress line
    expect(within(item).getByRole('progressbar', { name: 'Standard download progress' })).toBeInTheDocument()
    for (const k of ['Release', 'From', 'Why', 'Replaces']) expect(within(item).getByText(k)).toBeInTheDocument()
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
    const versions = await within(pane).findByRole('region', { name: 'Versions' })
    expect(await within(versions).findByRole('button', { name: 'Search Now' })).toBeDisabled()
  })

  it('offers Add a Slot while the Movie has a free Slot', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const pane = await openPaddington()
    await userEvent.click(await within(pane).findByRole('button', { name: 'Add a Slot' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
