import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'
import { slotRecord } from '../test/slots'
import { chooseTitleItem, openVersionMenu } from '../test/titleHeader'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Call = { method: string; url: string; body?: unknown }

function fakeManage() {
  const calls: Call[] = []
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  const version = (slot: 'standard' | '4k', profile: string) => ({
    id: 11,
    slot,
    profile,
    state: 'wanted' as const,
    long_missing: false,
    wanted_since: null,
    file: null,
    added_at: '2026-10-17T12:00:00Z',
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
  it('adds a Version to an empty Slot from the Title menu, with the default Profile selected', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).queryByRole('listitem', { name: '4K' })).not.toBeInTheDocument()

    await chooseTitleItem(pane, 'Add Version…')
    const dialog = await screen.findByRole('dialog', { name: 'Add Version' })
    expect(within(dialog).getByRole('combobox', { name: 'Slot' })).toHaveValue('4k')
    expect(within(dialog).getByRole('combobox', { name: 'Profile' })).toHaveValue('4k-primary')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ slot: '4k', profile: '4k-primary' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Version' })).not.toBeInTheDocument())
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
    await chooseTitleItem(pane, 'Add Version…')
    expect(await screen.findByRole('combobox', { name: 'Profile' })).toHaveValue('4k-movies')
  })

  it("selects a Series' own default Profile in the Add Version dropdown", async () => {
    const series = row(7, 'Dark', 'Dark', { kind: 'series', slots: { standard: null, '4k': null } })
    fakeLibrary([series])
    server.use(
      http.get('/profiles', ({ response }) => response(200).json({ items: fourK })),
      http.get('/slots', ({ response }) =>
        response(200).json({ items: [slotRecord('standard', 'Standard', 0), slotRecord('4k', '4K', 1, { default_movies: '4k-movies', default_series: '4k-series' })] }),
      ),
      http.get('/titles/{id}', ({ response }) => response(200).json(detail(series, { kind: 'series', series_monitor: 'all' }))),
      http.get('/titles/{id}/episodes', ({ response }) => response(200).json({ items: [] })),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await chooseTitleItem(await screen.findByRole('region', { name: 'Dark' }), 'Add Version…')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Slot' }), '4k')
    expect(screen.getByRole('combobox', { name: 'Profile' })).toHaveValue('4k-series')
  })

  it('offers every enabled Profile for any Slot, the Slot default first', async () => {
    fakeManage()
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })
    await chooseTitleItem(pane, 'Add Version…')
    const dialog = await screen.findByRole('dialog', { name: 'Add Version' })
    const names = within(within(dialog).getByRole('combobox', { name: 'Profile' }))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(expect.arrayContaining(['HD', 'Any', '4K']))
  })

  it('shows a Profile another Version already uses as the Profile field error', async () => {
    fakeManage()
    server.use(
      http.post('/titles/{id}/versions', ({ response }) =>
        response(422).json({
          type: 'about:blank',
          title: 'validation',
          status: 422,
          detail: 'invalid',
          code: 'validation',
          errors: [{ field: 'profile', code: 'profile_taken', message: 'Another Version of the Title already uses that Profile' }],
        } as never),
      ),
    )
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })
    await chooseTitleItem(pane, 'Add Version…')
    const dialog = await screen.findByRole('dialog', { name: 'Add Version' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByText(/already uses that Profile/)).toBeInTheDocument()
  })

  it('switches a Version to another Profile of its Slot', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: /Change Profile…/ }))
    const dialog = screen.getByRole('dialog', { name: 'Change Profile' })
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Profile' }), 'Any')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch' }))

    await screen.findByRole('region', { name: /paddington/i })
    expect(calls.map((c) => c.body)).toEqual([{ profile: 'any-primary' }])
  })

  it('removes a Version without deleting files unless ticked', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Version…' }))
    let confirm = screen.getByRole('alertdialog', { name: 'Remove Version' })
    expect(within(confirm).getByRole('checkbox', { name: 'Also delete files' })).not.toBeChecked()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toContain('delete_files=false')
    expect(await findToast('Version removed')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Remove Version' })).not.toBeInTheDocument()

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Version…' }))
    confirm = screen.getByRole('alertdialog', { name: 'Remove Version' })
    await userEvent.click(within(confirm).getByRole('checkbox', { name: 'Also delete files' }))
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].url).toContain('delete_files=true')
  })

  it('closes the dialog on confirm and says in a Toast why removing a Version failed', async () => {
    fakeManage()
    server.use(http.delete('/versions/{id}', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'disk offline' }, { status: 500 })))
    const pane = await openPane()
    await within(pane).findByRole('listitem', { name: 'Standard' })

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Version…' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Remove Version' })).getByRole('button', { name: 'Remove' }))

    expect(await findToast('Could not remove the Version: disk offline')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Remove Version' })).not.toBeInTheDocument()
  })

  it('shows the original-language offer as a slim row under its Version, which accepts or dismisses it', async () => {
    const sent: string[] = []
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        const offer = {
          title_id: 1,
          title: 'Paddington',
          version_id: 11,
          slot: 'standard' as const,
          profile: 'hd-primary',
          release: 'Paddington.2014.1080p.BluRay.x264-GRP',
          score: 92,
          found_at: '2026-10-18T09:30:00Z',
          dismissed: false,
          releases: [],
        }
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, original_offer: offer })) })
      }),
      http.post('/versions/{id}/original-offer/accept', ({ params, response }) => {
        sent.push(`accept ${params.id}`)
        return response(201).json({ grabs: [], failed: 0 })
      }),
      http.post('/versions/{id}/original-offer/dismiss', ({ params, response }) => {
        sent.push(`dismiss ${params.id}`)
        return response(204).empty()
      }),
    )
    const pane = await openPane()

    expect(await within(pane).findByText('A Standard release in the original language only is available · Score 92')).toBeInTheDocument()
    await userEvent.click(within(pane).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(sent).toEqual(['dismiss 11']))
    await userEvent.click(within(pane).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(sent).toEqual(['dismiss 11', 'accept 11']))
  })
})
