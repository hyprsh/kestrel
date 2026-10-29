import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SiloSettings } from '../api/silo'
import { http } from '../test/handlers'
import { plexInstance, problem } from '../test/plex'
import { server } from '../test/server'
import { SiloSettingsForm } from './SiloSettings'

type Saved = SiloSettings & { from_config_file: boolean }

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SiloSettingsForm />
    </QueryClientProvider>,
  )

const siloInstance = (name: string, id: number) => ({ ...plexInstance(name, id), plugin_id: 'silo' })

/** Two Silo instances (and a Plex one that must not be offered) and the given Silo settings. */
function fakeSiloSettings(
  initial: Partial<Saved> = {},
  rejects?: { field: string; message: string }[],
  instances = [siloInstance('Living room Silo', 3), plexInstance('Plex', 4), siloInstance('Garage Silo', 5)],
) {
  let saved: Saved = { watch_ahead: false, instance: null, from_config_file: false, ...initial }
  const sent: SiloSettings[] = []
  server.use(
    http.get('/plugin-instances', ({ response }) => response(200).json({ items: instances, next_cursor: null })),
    http.get('/settings/silo', ({ response }) => response(200).json(saved)),
    http.put('/settings/silo', async ({ request, response }) => {
      if (rejects) return response(422).json({ ...problem(422, 'validation'), errors: rejects.map((r) => ({ ...r, code: 'invalid' })) })
      const body = (await request.json()) as SiloSettings
      sent.push(body)
      saved = { ...body, from_config_file: false }
      return response(200).json(saved)
    }),
  )
  return sent
}

describe('Silo settings', () => {
  it('saves the switch and the Silo instance, offering Silo instances only', async () => {
    const sent = fakeSiloSettings()
    renderCard()

    const instance = await screen.findByRole('combobox', { name: 'Silo instance' })
    expect(
      within(instance)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Living room Silo', 'Garage Silo'])
    expect(screen.getByRole('switch', { name: 'Watch-ahead for Series requested in Silo' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('switch', { name: 'Watch-ahead for Series requested in Silo' }))
    await userEvent.selectOptions(instance, 'Garage Silo')
    await userEvent.click(screen.getByRole('button', { name: 'Save Silo settings' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(sent).toEqual([{ watch_ahead: true, instance: 'Garage Silo' }])
  })

  it('shows what is saved and switches Watch-ahead off', async () => {
    const sent = fakeSiloSettings({ watch_ahead: true, instance: 'Living room Silo' })
    renderCard()

    expect(await screen.findByRole('switch', { name: 'Watch-ahead for Series requested in Silo' })).toBeChecked()
    const instance = screen.getByRole('combobox', { name: 'Silo instance' })
    expect(instance).toHaveValue('Living room Silo')
    await userEvent.click(screen.getByRole('switch', { name: 'Watch-ahead for Series requested in Silo' }))
    await userEvent.selectOptions(instance, 'None')
    await userEvent.click(screen.getByRole('button', { name: 'Save Silo settings' }))

    await screen.findByText('Saved.')
    expect(sent).toEqual([{ watch_ahead: false, instance: null }])
  })

  it('says to add a Silo media server first when there is none', async () => {
    fakeSiloSettings({}, undefined, [plexInstance('Plex', 4)])
    renderCard()

    expect(await screen.findByText('Add a Silo media server first: Watch-ahead reads who watched what from its playback history.')).toBeInTheDocument()
  })

  it('shows the server’s field errors', async () => {
    fakeSiloSettings({}, [{ field: 'instance', message: 'Name the Silo instance whose playback history Watch-ahead reads' }])
    renderCard()

    await userEvent.click(await screen.findByRole('switch', { name: 'Watch-ahead for Series requested in Silo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Silo settings' }))

    expect(await screen.findByText('Name the Silo instance whose playback history Watch-ahead reads')).toBeInTheDocument()
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
  })

  it('is read-only, with the declared note, while the Config File declares it', async () => {
    fakeSiloSettings({ watch_ahead: true, instance: 'Living room Silo', from_config_file: true })
    renderCard()

    expect(await screen.findByRole('switch', { name: 'Watch-ahead for Series requested in Silo' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Silo instance' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Silo settings' })).toBeDisabled()
    expect(screen.getByText(/Config File sets Silo/)).toBeInTheDocument()
  })
})
