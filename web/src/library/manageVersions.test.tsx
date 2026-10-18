import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Call = { method: string; url: string; body?: unknown }

function fakeManage() {
  const calls: Call[] = []
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  const version = (slot: 'hd' | 'uhd', profile: string) => ({
    id: 11, slot, profile, state: 'wanted' as const, long_missing: false, wanted_since: null, file: null, added_at: '2026-10-17T12:00:00Z',
  })
  server.use(
    http.post('/titles/{id}/versions', async ({ request, response }) => {
      calls.push({ method: 'POST', url: request.url, body: await request.clone().json() })
      return response(201).json(version('uhd', 'uhd-primary'))
    }),
    http.patch('/versions/{id}', async ({ request, response }) => {
      calls.push({ method: 'PATCH', url: request.url, body: await request.clone().json() })
      return response(200).json(version('hd', 'kids-primary'))
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
  it('adds a Version to an empty Slot', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const uhd = await within(pane).findByRole('group', { name: 'UHD' })

    await userEvent.click(await within(uhd).findByRole('button', { name: 'Add Version' }))
    await userEvent.click(within(uhd).getByRole('button', { name: 'Add' }))

    await screen.findByRole('region', { name: /paddington/i })
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ slot: 'uhd', profile: 'uhd-primary' })
  })

  it('switches a Version to another Profile of its Slot', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const hd = await within(pane).findByRole('group', { name: 'HD' })

    await userEvent.click(await within(hd).findByRole('button', { name: 'Change Profile' }))
    await userEvent.selectOptions(within(hd).getByRole('combobox', { name: 'Profile' }), 'Kids')
    await userEvent.click(within(hd).getByRole('button', { name: 'Switch' }))

    await screen.findByRole('region', { name: /paddington/i })
    expect(calls.map((c) => c.body)).toEqual([{ profile: 'kids-primary' }])
  })

  it('removes a Version without deleting files unless ticked', async () => {
    const calls = fakeManage()
    const pane = await openPane()
    const hd = await within(pane).findByRole('group', { name: 'HD' })

    await userEvent.click(await within(hd).findByRole('button', { name: 'Remove Version' }))
    const confirm = within(hd).getByRole('group', { name: 'Remove Version' })
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
