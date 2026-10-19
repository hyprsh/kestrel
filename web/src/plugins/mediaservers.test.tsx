import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http, sabnzbd } from '../test/handlers'
import { server } from '../test/server'

type Instance = components['schemas']['PluginInstance']

const jellyfin: components['schemas']['PluginManifest'] = {
  id: 'jellyfin',
  name: 'Jellyfin',
  contract: 'media_server.v1',
  version: '1',
  capabilities: {},
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, default: null, help: '', options: [], live: false },
    { key: 'api_key', label: 'API key', type: 'secret', required: true, default: null, help: '', options: [], live: false },
  ],
}

const stored: Instance = {
  id: 7,
  contract: 'media_server.v1',
  plugin_id: 'jellyfin',
  name: 'Living room',
  enabled: true,
  priority: 0,
  config: { url: 'http://jellyfin:8096' },
  secrets_set: ['api_key'],
  from_config_file: false,
}

describe('Settings media servers', () => {
  it('lists the configured media servers and offers to add one', async () => {
    server.use(
      http.get('/plugins', ({ response }) => response(200).json({ items: [sabnzbd, jellyfin], next_cursor: null })),
      http.get('/plugin-instances', ({ response }) => response(200).json({ items: [stored], next_cursor: null })),
    )
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const section = within(await screen.findByRole('region', { name: 'Media servers' }))
    const form = within(await section.findByRole('form', { name: 'Living room' }))
    expect(form.getByLabelText('URL')).toHaveValue('http://jellyfin:8096')
    expect(form.getByLabelText('API key')).toHaveValue('')
    await userEvent.click(section.getByRole('button', { name: 'Add media server' }))
    expect(await section.findByRole('form', { name: 'New media server' })).toBeInTheDocument()
  })
})
