import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { queueItem } from '../test/queue'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'
import { openTitleMenu } from '../test/titleHeader'

/** The Monitored button of the header, named by the state it shows. */
const MONITORING = /^Monitoring: /

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** A Library with one Movie whose PATCH /titles/{id} records the body and applies `monitored`. */
function fakeMovie() {
  const r = row(1, 'Heat', 'Heat')
  fakeLibrary([r])
  const state = { monitored: true, sent: [] as Sent[] }
  const unmonitored = () => (state.monitored ? r : { ...r, slots: { standard: { ...r.slots.standard!, state: 'unmonitored' as const }, '4k': null } })
  server.use(
    http.get('/titles/{id}', ({ response }) => response(200).json(detail(unmonitored(), { monitored: state.monitored }))),
    http.patch('/titles/{id}', async ({ request, response }) => {
      const body = await request.json()
      state.sent.push({ path: 'titles', body })
      if (body.monitored !== undefined) state.monitored = body.monitored
      return response(200).json(detail(unmonitored(), { monitored: state.monitored }))
    }),
  )
  return state
}

describe('monitoring a Movie', () => {
  it('shows a green Monitored button that stops monitoring; an unmonitored Movie keeps its header, with the one monitoring button and Search disabled', async () => {
    const state = fakeMovie()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Heat' })
    const button = await within(pane).findByRole('button', { name: 'Monitored' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(within(pane).getByRole('button', { name: 'Search Standard' })).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument()
    expect(pane.querySelector('[data-muted]')).toBeNull()

    await userEvent.click(button)

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { monitored: false } }]))
    const off = await within(pane).findByRole('button', { name: 'Not monitored' })
    expect(off).toHaveAttribute('aria-pressed', 'false')
    expect(pane.querySelector('[data-muted]')).not.toBeNull() // the poster is muted
    // No second Monitor button: the one monitoring button turns it on. Search stays, disabled with the reason.
    expect(within(pane).queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument()
    const search = within(pane).getByRole('button', { name: 'Search Wanted' })
    expect(search).toBeDisabled()
    expect(search).toHaveAttribute('title', 'Not monitored: turn monitoring on to search')
    expect(within(pane).getByTitle('Kestrel searches nothing. Its Standard Version would be Wanted once monitored.')).toBeInTheDocument()

    await userEvent.click(off)

    await waitFor(() => expect(state.sent[1]).toEqual({ path: 'titles', body: { monitored: true } }))
    expect(await within(pane).findByRole('button', { name: 'Monitored' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pane).getByRole('button', { name: 'Search Standard' })).toBeInTheDocument()
  })
})

describe('the header of a Movie that is not monitored', () => {
  const unmonitoredMovie = (over: Parameters<typeof detail>[1] = {}, items: ReturnType<typeof queueItem>[] = []) => {
    const r = row(1, 'El Camino', 'El Camino')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { monitored: false, ...over }))),
      http.get('/queue', ({ response }) => response(200).json({ items })),
    )
  }
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    return screen.findByRole('region', { name: 'El Camino' })
  }

  it('says a running download still finishes and Kestrel searches nothing else', async () => {
    unmonitoredMovie({}, [queueItem({ title_id: 1, slot: 'standard', bytes_total: 100, bytes_left: 60 })])
    const pane = await open()
    expect(await within(pane).findByTitle('The Standard download (40%) still finishes; Kestrel searches nothing else.')).toBeInTheDocument()
    expect(within(pane).queryByTitle(/would be Wanted/)).not.toBeInTheDocument()
    expect(within(pane).queryByTitle(/keeps its file/)).not.toBeInTheDocument()
  })

  it('says it keeps its file and searches nothing when it holds one', async () => {
    const r = row(1, 'El Camino', 'El Camino', { slots: { standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null } })
    fakeLibrary([r])
    const d = detail(r, { monitored: false })
    server.use(
      http.get('/titles/{id}', ({ response }) =>
        response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, file: { path: '/m/a.mkv', size: 1, release_name: 'a', imported_at: '2026-10-01T00:00:00Z', score: null } })) }),
      ),
    )
    const pane = await open()
    expect(await within(pane).findByTitle('Kestrel keeps its file and searches nothing.')).toBeInTheDocument()
  })
})

describe('monitoring a Series', () => {
  it('has a Monitored · all episodes button next to Search, not on the meta line, with the three modes and two switches in its menu', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    const button = await within(pane).findByRole('button', { name: MONITORING })
    expect(button).toHaveTextContent('Monitored · all episodes')
    expect(within(pane).getByRole('button', { name: 'Search Wanted' })).toBeInTheDocument()
    expect(within(pane).getByTitle(/^Kestrel searches every Wanted episode and grabs new ones as they air\./)).toBeInTheDocument()
    expect(within(pane).getByTitle(/1 Special is not monitored\./)).toBeInTheDocument()

    await userEvent.click(button)
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((o) => o.textContent),
    ).toEqual([
      'All episodesSearch the past ones that are missing, and new ones',
      'Future episodes onlyLeave what aired before; grab what airs from now',
      'Not monitoredKeep the files, search nothing',
    ])
    expect(within(menu).getByRole('menuitemradio', { name: /^All episodes/ })).toBeChecked()
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor new seasons/ })).toBeChecked()
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor Specials/ })).not.toBeChecked()

    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /^Future episodes only/ }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'future' } }))
    await waitFor(() => expect(within(pane).getByRole('button', { name: MONITORING })).toHaveTextContent('Monitored · future episodes'))
  })

  it('turns Monitor new seasons and Monitor Specials on and off', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    await userEvent.click(await within(pane).findByRole('button', { name: MONITORING }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /^Monitor Specials/ }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { monitor_specials: true } }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /^Monitor new seasons/ }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { monitor_new_seasons: false } }))
    expect(await screen.findByRole('menuitemcheckbox', { name: /^Monitor Specials/ })).toBeChecked()
    expect(screen.getByRole('menuitemcheckbox', { name: /^Monitor new seasons/ })).not.toBeChecked()
  })

  it('has no Monitoring… item in the Title menu any more', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    const menu = await openTitleMenu(pane)
    expect(within(menu).queryByRole('menuitem', { name: /^Monitoring…/ })).not.toBeInTheDocument()
  })
})

describe('the switches of the Monitoring menu', () => {
  it('say what they do, and are off and say when it applies while the Series is not monitored, keeping their values', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: MONITORING }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor new seasons/ })).toHaveTextContent('Seasons added later start monitored')
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor Specials/ })).toHaveTextContent('Season 0 follows the mode above')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /^Not monitored/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: MONITORING })).toHaveTextContent('Not monitored'))
    await userEvent.click(screen.getByRole('button', { name: MONITORING }))
    menu = await screen.findByRole('menu')
    for (const name of [/^Monitor new seasons/, /^Monitor Specials/]) {
      const item = within(menu).getByRole('menuitemcheckbox', { name })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveTextContent('Applies when monitored')
    }
    // The stored values stay: new seasons were on, Specials off.
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor new seasons/ })).toBeChecked()
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Monitor Specials/ })).not.toBeChecked()
  })
})

describe('a Series that is not monitored', () => {
  it('shows an outline Not monitored button and says why Search Wanted is disabled', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: MONITORING }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^Not monitored/ }))

    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'none' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: MONITORING })).toHaveTextContent('Not monitored'))
    expect(screen.getByTitle(/Kestrel keeps the files and searches nothing\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: MONITORING }))
    expect(screen.getByRole('menuitemradio', { name: /^Not monitored/ })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: /^All episodes/ })).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    const search = screen.getByRole('button', { name: 'Search Wanted' })
    expect(search).toBeDisabled()
    expect(search).toHaveAttribute('title', 'Not monitored: turn monitoring on to search')
  })
})
