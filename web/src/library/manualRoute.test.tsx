import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeGrabs, fakeSteps, grabEntry, releaseList, stepsOf } from '../test/grabs'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'
import { chooseSearchItem } from '../test/titleHeader'
import { placeOf } from '../place'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** Serves the Releases search and records each request body. */
function fakeReleases() {
  const sent: unknown[] = []
  server.use(
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      sent.push({
        version: Number(params.id),
        body: await request
          .clone()
          .json()
          .catch(() => null),
      })
      return response(200).json(releaseList())
    }),
  )
  return sent
}

const table = () => screen.findByRole('table', { name: /releases/i })
const here = () => location.pathname + location.search
/** The Manual search the address names (the results also keep their sort there). */
const searchAt = () => placeOf(here()).search

beforeEach(() => history.replaceState(null, '', '/'))

describe('the address of Manual search', () => {
  it('is pushed when Manual search opens from the Title page, and Back returns to the Title', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeReleases()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await chooseSearchItem(await screen.findByRole('region', { name: /paddington/i }), /manual search/i)
    await table()
    expect(searchAt()).toEqual({ titleId: 1, versionId: 11, scope: null })

    history.back()
    await waitFor(() => expect(screen.queryByRole('table', { name: /releases/i })).not.toBeInTheDocument())
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
    expect(here()).toBe('/library')
  })

  it('goes back to the Title with the Back button of the page, which also pops the address', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    fakeReleases()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await chooseSearchItem(await screen.findByRole('region', { name: /paddington/i }), /manual search/i)
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Back to Paddington' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
    await waitFor(() => expect(here()).toBe('/library'))
  })

  it('stays on Manual search after a reload, and Back then shows the Title', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const sent = fakeReleases()
    history.replaceState(null, '', '/library/1/search?version=11')
    renderApp()
    await table()
    expect(sent).toEqual([{ version: 11, body: null }])
    expect(searchAt()).toEqual({ titleId: 1, versionId: 11, scope: null })
    await userEvent.click(screen.getByRole('button', { name: 'Back to Paddington' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
    expect(here()).toBe('/library')
  })

  it('narrows to the season or episode the address names', async () => {
    fakeSeries()
    const sent = fakeReleases()
    history.replaceState(null, '', '/library/5/search?version=52&scope=S01')
    renderApp()
    await table()
    expect(screen.getByText('Season 1')).toBeInTheDocument()
    expect(sent).toEqual([{ version: 52, body: { season: 1 } }])
  })

  it('narrows to an episode of the season by its code', async () => {
    fakeSeries()
    const sent = fakeReleases()
    history.replaceState(null, '', '/library/5/search?version=51&scope=S01E02')
    renderApp()
    await table()
    expect(screen.getByText('S01E02')).toBeInTheDocument()
    expect(sent).toEqual([{ version: 51, body: { season: 1, episode_ids: [3] } }])
  })

  it('says so when the Version in the address is gone', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    history.replaceState(null, '', '/library/1/search?version=999')
    renderApp()
    expect(await screen.findByText('This Version is gone.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('reads a scope code and ignores one it does not know', () => {
    expect(placeOf('/library/1/search?version=11&scope=S02E03,E04').search).toEqual({ titleId: 1, versionId: 11, scope: 'S02E03,E04' })
    expect(placeOf('/library/1/search').search).toBeNull() // no Version to search
    expect(placeOf('/library/1/search?version=11&scope=junk').search).toEqual({ titleId: 1, versionId: 11, scope: null })
  })
})

describe('opening Manual search from elsewhere', () => {
  it('opens the search of a failed Grab from Activity, and Back returns to Activity', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington')])
    fakeReleases()
    fakeSteps([stepsOf({ grab_id: 31, files: [], formats: [], blocklist_id: null, still_wanted: true })])
    fakeGrabs([grabEntry({ grab_id: 31, state: 'failed', failure: 'download_failed', title: 'Paddington', title_id: 5, version_id: 51 })])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))
    await userEvent.click(await within(item).findByRole('button', { name: 'Manual Search…' }))
    await table()
    expect(searchAt()).toEqual({ titleId: 5, versionId: 51, scope: null })

    history.back()
    expect(await screen.findByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(here()).toBe('/activity')
  })
})
