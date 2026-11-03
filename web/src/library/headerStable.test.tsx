import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

// An accordion row's header says the same thing open or closed (#388): opening adds the body below it and changes nothing above.

/** Opens the Title named `name` from the Library: it is the pane beside the list on a wide screen, and a page of its own on a phone. */
async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  if (typeof window.matchMedia === 'function') await userEvent.click(await screen.findByRole('option', { name }))
}

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

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

/** The header of a listitem: everything but the body, which comes after it. */
const header = (item: HTMLElement) => item.firstElementChild?.textContent ?? ''

/** Returns the header text of the row named `name` while it is closed and while it is open. */
async function closedAndOpen(scope: ReturnType<typeof within>, name: RegExp) {
  const button = scope.getByRole('button', { name })
  const item = button.closest('[role=listitem]') as HTMLElement
  if (button.getAttribute('aria-expanded') === 'true') await userEvent.click(button)
  const closed = header(item)
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  return { closed, open: header(item) }
}

async function openMovie() {
  await openTitle(/paddington/i)
  const pane = await screen.findByRole('region', { name: /paddington/i })
  await within(pane).findByRole('button', { name: 'Title actions' })
  return within(await within(pane).findByRole('region', { name: 'Versions' }))
}

const withVersions = (over: object) =>
  server.use(
    http.get('/titles/{id}', ({ response }) => {
      const d = detail(row(1, 'Paddington', 'Paddington'))
      return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, ...over })) })
    }),
  )

function stableTests() {
  it('a Movie Version with a file', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    withVersions({ state: 'filled', file })
    const { closed, open } = await closedAndOpen(await openMovie(), /^Standard:/)
    expect(open).toBe(closed)
    for (const part of ['Standard', 'WEB-DL 1080p', 'Paddington (2014) - [Standard][WEBDL-1080p].mkv', 'Imported', '1.6 GB']) expect(closed).toContain(part)
  })

  it('a Wanted Movie Version', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    withVersions({ state: 'wanted', wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })
    const { closed, open } = await closedAndOpen(await openMovie(), /^Standard: Wanted/)
    expect(open).toBe(closed)
    expect(closed).toContain('Wanted')
  })

  it('a downloading Movie Version', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 1, slot: 'standard' })])
    const { closed, open } = await closedAndOpen(await openMovie(), /^Standard: Downloading/)
    expect(open).toBe(closed)
    expect(closed).toContain('Downloading 75%')
  })

  it('a Series Version and a Season', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 100) } }), episode(3, 1, 2, 'Cat', { cells: { standard: cell('wanted') } })]
    const r = seriesRow(5, 'Breaking Bad')
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { kind: 'series', series_monitor: 'all' }))))
    await openTitle(/breaking bad/i)
    await screen.findByRole('grid', { name: 'Episodes' })
    const v = await closedAndOpen(within(await screen.findByRole('region', { name: 'Versions' })), /^Standard:/)
    expect(v.open).toBe(v.closed)
    const s = await closedAndOpen(within(screen.getByRole('region', { name: 'Seasons' })), /^Season 1:/)
    expect(s.open).toBe(s.closed)
    expect(s.closed).toContain('Season 1')
  })
}

describe('an accordion row header open and closed', stableTests)

describe('an accordion row header open and closed, on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  stableTests()
})
