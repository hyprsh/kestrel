// The tiles of the Health screen as healthOf makes them: three groups, a detail line each, failing first.
import { describe, expect, it } from 'vitest'
import type { SystemStatus } from '../api/attention'
import { clockTime } from '../time'
import { healthOf, sinceOf } from './tiles'

const now = Date.parse('2026-11-01T15:00:00')
const GB = 2 ** 30
const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null, since: null }
const status = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '1.8.2',
  started_at: '2026-10-25T10:00:00Z',
  services: [],
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [],
  disks: [{ path: '/media/tv', free_bytes: 800 * GB, total_bytes: 1000 * GB, low_free_bytes: 50 * GB }],
  trash: { commit: 'abc1234def', committed_at: new Date(now - 3 * 86_400_000).toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})
const indexer = (id: number, name: string, over: Partial<SystemStatus['indexers'][number]> = {}) => ({ instance_id: id, name, state: 'ok' as const, message: null, ...idle, ...over })
const tilesOf = (s: SystemStatus, title: string) => healthOf(s, now).groups.find((g) => g.title === title)?.tiles ?? []

describe('healthOf', () => {
  it('groups the tiles as Connections, Storage and System', () => {
    const s = status({ indexers: [indexer(11, 'Alpha')], services: [{ kind: 'metadata_provider', name: 'TMDB', instance_id: null, state: 'ok', message: null, since: null }] })
    const groups = healthOf(s, now).groups
    expect(groups.map((g) => g.title)).toEqual(['Connections', 'Storage', 'System'])
    expect(tilesOf(s, 'Connections').map((t) => t.name)).toEqual(['SABnzbd', 'Alpha', 'TMDB'])
    expect(tilesOf(s, 'Storage').map((t) => t.name)).toEqual(['/media/tv'])
    expect(tilesOf(s, 'System').map((t) => t.name)).toEqual(['Version', 'TRaSH'])
  })

  it('leaves out a group with nothing in it', () => {
    expect(healthOf(status({ disks: [] }), now).groups.map((g) => g.title)).toEqual(['Connections', 'System'])
  })

  it('puts the indexers that answer into one tile, and keeps a paused, off or failing one on its own', () => {
    const s = status({
      indexers: [
        indexer(11, 'NZBgeek', { search_used: 12 }),
        indexer(12, 'DrunkenSlug', { search_used: 30 }),
        indexer(13, 'Paused', { search_paused_until: '2026-11-01T16:05:00' }),
        indexer(14, 'Off', { state: 'disabled' }),
        indexer(15, 'altHUB', { state: 'failing', message: '401: bad API key', since: '2026-11-01T12:12:00' }),
      ],
    })
    const tiles = tilesOf(s, 'Connections')
    expect(tiles.map((t) => t.name)).toEqual(['altHUB', 'SABnzbd', 'Paused', 'Off', 'NZBgeek, DrunkenSlug'])
    expect(tiles.find((t) => t.name === 'NZBgeek, DrunkenSlug')).toMatchObject({ tone: 'ok', detail: 'Answering · 42 searches today' })
    expect(tiles.find((t) => t.name === 'Paused')).toMatchObject({ tone: 'paused', detail: expect.stringMatching(/^Searches paused until/) })
    expect(tiles.find((t) => t.name === 'Off')).toMatchObject({ tone: 'idle', detail: 'Disabled' })
  })

  it('names a lone indexer and its budget', () => {
    const t = tilesOf(status({ indexers: [indexer(11, 'Alpha', { search_used: 42, search_max: 100 })] }), 'Connections')
    expect(t[1]).toMatchObject({ name: 'Alpha', detail: 'Answering · 42 of 100 searches today' })
  })

  it('tints a failing tile and says since when, failing tiles first', () => {
    const s = status({ indexers: [indexer(15, 'altHUB', { state: 'failing', message: '401: bad API key', since: '2026-11-01T12:12:00' })] })
    const [first] = tilesOf(s, 'Connections')
    expect(first).toMatchObject({ name: 'altHUB', tone: 'failing', instanceId: 15, detail: `401: bad API key, since ${clockTime('2026-11-01T12:12:00')}` })
    expect(healthOf(s, now)).toMatchObject({ failing: 1, warnings: 0, ok: 4 })
  })

  it('says the day when a failure began before today', () => {
    expect(sinceOf('2026-10-30T12:12:00', now)).toMatch(/^Oct 30, /)
    expect(sinceOf('2026-11-01T12:12:00', now)).toBe(clockTime('2026-11-01T12:12:00'))
  })

  it('shows each disk with its free space and how much is used, amber when low', () => {
    const s = status({
      disks: [
        { path: '/media/tv', free_bytes: 800 * GB, total_bytes: 1000 * GB, low_free_bytes: 50 * GB },
        { path: '/media/movies', free_bytes: 30 * GB, total_bytes: 1000 * GB, low_free_bytes: 50 * GB },
      ],
    })
    const [tv, movies] = tilesOf(s, 'Storage')
    expect(tv).toMatchObject({ tone: 'ok', detail: '800 GB free · 20% used' })
    expect(movies).toMatchObject({ tone: 'low', detail: '30 GB free · 97% used · low' })
    expect(healthOf(s, now).warnings).toBe(1)
  })

  it('lists the metadata providers and media servers, failing by their rows', () => {
    const s = status({
      services: [
        { kind: 'metadata_provider', name: 'TMDB', instance_id: null, state: 'ok', message: null, since: null },
        { kind: 'media_server', name: 'Plex', instance_id: 7, state: 'failing', message: 'Plex is unreachable', since: '2026-11-01T09:00:00' },
      ],
    })
    const tiles = tilesOf(s, 'Connections')
    expect(tiles[0]).toMatchObject({ name: 'Plex', tone: 'failing', instanceId: 7, detail: `Plex is unreachable, since ${clockTime('2026-11-01T09:00:00')}` })
    expect(tiles.find((t) => t.name === 'TMDB')).toMatchObject({ tone: 'ok', detail: 'No problems seen' })
  })

  it('shows the version, an update that is waiting, the TRaSH snapshot and paused Grabs under System', () => {
    expect(tilesOf(status(), 'System')).toMatchObject([
      { name: 'Version', tone: 'ok', detail: '1.8.2 · up to date' },
      { name: 'TRaSH', detail: 'Snapshot 3 days old' },
    ])
    const updating = tilesOf(status({ update: { version: '1.9.0', url: 'https://example.test/r' }, grabs_paused: true }), 'System')
    expect(updating[0]).toMatchObject({ name: 'Version', tone: 'update', detail: '1.8.2 · 1.9.0 available', link: { path: '/settings/about', label: 'About' } })
    expect(updating.find((t) => t.key === 'grabs')).toMatchObject({ tone: 'paused', detail: 'Automatic Grabs are paused' })
  })

  it('says when no download client is set up', () => {
    const [client] = tilesOf(status({ download_client: { state: 'none', name: null, instance_id: null, message: null } }), 'Connections')
    expect(client).toMatchObject({ tone: 'idle', word: 'not set up', detail: 'No download client set up' })
  })

  it('counts the failing, the warnings and the rest, which add up to the tiles', () => {
    const s = status({ grabs_paused: true, download_client: { state: 'failing', name: 'SABnzbd', instance_id: 3, message: 'refused', since: '2026-11-01T14:00:00' } })
    const h = healthOf(s, now)
    expect(h).toMatchObject({ failing: 1, warnings: 1 })
    expect(h.failing + h.warnings + h.ok).toBe(h.groups.flatMap((g) => g.tiles).length)
  })
})
