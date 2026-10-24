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
  fields: [{ key: 'url', label: 'URL', type: 'url', required: true, default: null, help: '', options: [], live: false }],
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const server1: Instance = {
  id: 7,
  contract: 'media_server.v1',
  plugin_id: 'jellyfin',
  name: 'Living room',
  enabled: true,
  priority: 0,
  config: { url: 'http://jellyfin:8096' },
  secrets_set: [],
  from_config_file: false,
  enabled_declared: false,
  last_check: null,
}

describe('the last check in a Settings row', () => {
  const open = async (items: Instance[]) => {
    server.use(
      http.get('/plugins', ({ response }) => response(200).json({ items: [sabnzbd, jellyfin], next_cursor: null })),
      http.get('/plugin-instances', ({ response }) => response(200).json({ items, next_cursor: null })),
    )
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    return within(await screen.findByRole('region', { name: 'Media servers' }))
  }

  it('says when the instance was last checked and that it answered', async () => {
    const section = await open([{ ...server1, last_check: { at: minutesAgo(5), ok: true, code: null, message: null } }])
    expect(await section.findByText('Checked 5 min ago: OK')).toBeInTheDocument()
  })

  it('says what failed, with the whole message', async () => {
    const message = 'Get "http://jellyfin:8096/System/Info": dial tcp 192.168.1.20:8096: connect: connection refused'
    const section = await open([{ ...server1, last_check: { at: minutesAgo(20), ok: false, code: 'unavailable', message } }])
    expect(await section.findByText(`Check failed 20 min ago: ${message}`)).toBeInTheDocument()
  })

  it('shows nothing before the first check', async () => {
    const section = await open([server1])
    await section.findByText('Living room')
    expect(section.queryByText(/Check/)).not.toBeInTheDocument()
  })
})
