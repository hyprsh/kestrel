import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Call = { method: string; url: string; body?: unknown }

function fakeManage() {
  const calls: Call[] = []
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  const version = (slot: 'standard' | '4k', profile: string) => ({
    id: 11, slot, profile, state: 'wanted' as const, long_missing: false, wanted_since: null, file: null, added_at: '2026-10-17T12:00:00Z',
  })
  server.use(
    http.post('/titles/{id}/versions', async ({ request, response }) => {
      calls.push({ method: 'POST', url: request.url, body: await request.clone().json() })
      return response(201).json(version('4k', '4k-primary'))
    }),
    http.patch('/versions/{id}', async ({ request, response }) => {
      calls.push({ method: 'PATCH', url: request.url, body: await request.clone().json() })
      return response(200).json(version('standard', 'any-primary'))
    }),
    http.delete('/versions/{id}', ({ request, response }) => {
      calls.push({ method: 'DELETE', url: request.url })
      return response(204).empty()
    }),
  )
  return calls
}

async function openPane() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('region', { name: /paddington/i })
}

describe('manage Versions', () => {
  it('adds a Version to an empty Slot from a dropdown with the default Profile selected', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const uhd = await within(pane).findByRole('listitem', { name: '4K' })

    await userEvent.click(await within(uhd).findByRole('button', { name: 'Add Version: 4K' }))
    expect(screen.getByRole('option', { name: '4K', selected: true })).toBeInTheDocument()
    expect(within(uhd).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: '4K' }))

    await screen.findByRole('region', { name: /paddington/i })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ slot: '4k', profile: '4k-primary' })
  })

  const fourK = ['4k-movies', '4k-series'].map((key, i) => ({
    key,
    name: key === '4k-movies' ? '4K movies' : '4K series',
    slot: '4k' as const,
    language_rule: 'primary' as const,
    original_language: 'reject' as const,
    original_fallback: false,
    from_config_file: false,
    enabled: true,
    default_movies: i === 0,
    default_series: i === 1,
    min_height: 0,
    max_height: 2160,
    trash_profile_movies: 'uhd-bluray-web',
    trash_profile_series: 'uhd-bluray-web',
  }))

  it("selects a Movie's default Profile in the Add Version dropdown", async () => {
    fakeManage()
    server.use(http.get('/profiles', ({ response }) => response(200).json({ items: fourK })))
    const pane = await openPane()
    expect(await within(pane).findByRole('button', { name: 'Add Version: 4K movies' })).toBeInTheDocument()
  })

  it("selects a Series' own default Profile in the Add Version dropdown", async () => {
    const series = row(7, 'Dark', 'Dark', { kind: 'series', slots: { standard: null, '4k': null } })
    fakeLibrary([series])
    server.use(
      http.get('/profiles', ({ response }) => response(200).json({ items: fourK })),
      http.get('/titles/{id}', ({ response }) => response(200).json(detail(series, { kind: 'series', series_monitor: 'all' }))),
      http.get('/titles/{id}/episodes', ({ response }) => response(200).json({ items: [] })),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('button', { name: 'Add Version: 4K series' })).toBeInTheDocument()
  })

  it('switches a Version to another Profile of its Slot', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })

    await userEvent.click(await within(hd).findByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change Profile' }))
    await userEvent.selectOptions(within(hd).getByRole('combobox', { name: 'Profile' }), 'Any')
    await userEvent.click(within(hd).getByRole('button', { name: 'Switch' }))

    await screen.findByRole('region', { name: /paddington/i })
    expect(calls.map((c) => c.body)).toEqual([{ profile: 'any-primary' }])
  })

  it('removes a Version without deleting files unless ticked', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })

    await userEvent.click(await within(hd).findByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Version' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Version' })
    expect(within(confirm).getByRole('checkbox', { name: 'Also delete files' })).not.toBeChecked()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toContain('delete_files=false')

    await userEvent.click(within(confirm).getByRole('checkbox', { name: 'Also delete files' }))
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].url).toContain('delete_files=true')
  })
})
