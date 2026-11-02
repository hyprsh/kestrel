import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { fakeSetup } from '../test/fakeSetup'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { slot } from '../test/slots'

type Profile = components['schemas']['Profile']
type Suggestion = components['schemas']['ProfileSuggestion']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const profile = (key: string, name: string, over: Partial<Profile> = {}): Profile => ({
  key,
  name,
  release_family: 'bluray-web',
  resolution: 'hd',
  kinds: ['movie', 'series'],
  language_rule: 'primary',
  original_language: 'reject',
  original_fallback: false,
  from_config_file: false,
  enabled: true,
  default_movies: false,
  default_series: false,
  min_height: 720,
  max_height: 1080,
  trash_profile_movies: 'hd-bluray-web',
  trash_profile_series: 'web-1080p',
  ...over,
})

const suggestion = (name: string, resolution: Suggestion['resolution'], language_rule: Suggestion['language_rule'], over: Partial<Suggestion> = {}): Suggestion => ({
  name,
  release_family: 'bluray-web',
  resolution,
  language_rule,
  kinds: ['movie', 'series'],
  ...over,
})

/** The state after "One copy": HD is Standard's default; the server offers a few Profiles to add. */
function fakeStep(extra: Profile[] = []) {
  const sent: { method: string; body: unknown }[] = []
  let profiles = [profile('hd-primary', 'HD', { default_movies: true, default_series: true }), ...extra]
  const offered = [suggestion('HD Original', 'hd', 'original'), suggestion('Any', 'any', 'primary'), suggestion('4K Remux', '4k', 'primary', { release_family: 'remux-web' })]
  fakeSetup({ language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', slots: 'done' })
  server.use(
    http.get('/slots', ({ response }) => response(200).json({ items: [slot('standard', 'Standard', 0)] })),
    http.get('/profiles', ({ response }) => response(200).json({ items: profiles })),
    http.get('/profiles/suggestions', ({ response }) => {
      const have = new Set(profiles.map((p) => p.name))
      const items = offered.filter((s) => !have.has(s.name))
      return response(200).json({ groups: items.length ? [{ release_family: 'bluray-web', name: 'Bluray + WEB', items }] : [] })
    }),
    http.post('/profiles', async ({ request, response }) => {
      const body = (await request.json()) as Partial<Suggestion>
      sent.push({ method: 'POST', body })
      const hit = offered.find((s) => s.resolution === body.resolution && s.language_rule === body.language_rule)!
      const made = profile(`made-${profiles.length}`, hit.name, { language_rule: hit.language_rule, custom: true, min_height: hit.resolution === 'any' ? 0 : 720, resolution: hit.resolution })
      profiles = [...profiles, made]
      return response(201).json(made)
    }),
    http.patch('/profiles/{key}', async ({ request, params, response }) => {
      const body = (await request.json()) as { enabled?: boolean }
      sent.push({ method: 'PATCH', body: { key: params.key, ...body } })
      profiles = profiles.map((p) => (p.key === params.key ? { ...p, ...body } : p))
      return response(200).json(profiles.find((p) => p.key === params.key)!)
    }),
  )
  return sent
}

const step = async () => {
  const region = await screen.findByRole('region', { name: 'Profiles' })
  await within(region).findByRole('checkbox', { name: /^HD$/ })
  return region
}

describe('the wizard Profiles step', () => {
  it('after One copy shows HD ticked and locked, with HD Original and Any offered unticked', async () => {
    fakeStep()
    renderApp()
    const region = await step()

    const hd = within(region).getByRole('checkbox', { name: /^HD$/ })
    expect(hd).toBeChecked()
    expect(hd).toBeDisabled()
    expect(within(region).getByText(/Standard/)).toBeInTheDocument() // says why it is locked

    expect(within(region).getByRole('checkbox', { name: /HD Original/ })).not.toBeChecked()
    expect(within(region).getByRole('checkbox', { name: /^Any$/ })).not.toBeChecked()
    expect(within(region).queryByRole('checkbox', { name: /4K Remux/ })).not.toBeInTheDocument() // does not fit the Slots
  })

  it('ticking Any imports and enables it; unticking disables it', async () => {
    const sent = fakeStep()
    renderApp()
    const region = await step()

    await userEvent.click(within(region).getByRole('checkbox', { name: /^Any$/ }))
    await waitFor(() => expect(sent).toEqual([{ method: 'POST', body: { release_family: 'bluray-web', resolution: 'any', language_rule: 'primary' } }]))
    await waitFor(() => expect(within(region).getByRole('checkbox', { name: /^Any$/ })).toBeChecked())

    await userEvent.click(within(region).getByRole('checkbox', { name: /^Any$/ }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ method: 'PATCH', body: { key: 'made-1', enabled: false } }))
    await waitFor(() => expect(within(region).getByRole('checkbox', { name: /^Any$/ })).not.toBeChecked())

    await userEvent.click(within(region).getByRole('checkbox', { name: /^Any$/ }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ method: 'PATCH', body: { key: 'made-1', enabled: true } }))
  })

  it('lists a Profile the household disabled, unticked, and ticking it enables it again', async () => {
    const sent = fakeStep([profile('hd-original', 'HD Original', { enabled: false, language_rule: 'original' })])
    renderApp()
    const region = await step()

    const box = within(region).getByRole('checkbox', { name: /HD Original/ })
    expect(box).not.toBeChecked()
    expect(within(region).getAllByRole('checkbox', { name: /HD Original/ })).toHaveLength(1) // not also suggested
    await userEvent.click(box)
    await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', body: { key: 'hd-original', enabled: true } }]))
    await waitFor(() => expect(within(region).getByRole('checkbox', { name: /HD Original/ })).toBeChecked())
  })

  it('opens the full Suggested list inside the wizard instead of linking to Settings', async () => {
    const sent = fakeStep()
    renderApp()
    const region = await step()
    expect(within(region).queryByRole('link', { name: /More/ })).not.toBeInTheDocument()

    await userEvent.click(within(region).getByText('More…'))
    const suggested = await within(region).findByRole('region', { name: 'Suggested' })
    expect(within(suggested).getByText('4K Remux')).toBeInTheDocument() // the one that does not fit the Slots
    await userEvent.click(within(suggested).getByRole('button', { name: 'Add 4K Remux' }))
    await waitFor(() => expect(sent).toEqual([{ method: 'POST', body: { release_family: 'remux-web', resolution: '4k', language_rule: 'primary' } }]))
  })
})
