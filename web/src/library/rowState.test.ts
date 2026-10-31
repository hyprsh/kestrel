import { describe, expect, it } from 'vitest'
import type { components } from '../api/schema.gen'
import { row } from '../test/library'
import { posterBadge, shownSlots, stateLine } from './rowState'

type QueueItem = components['schemas']['QueueItem']
type SlotSummary = components['schemas']['SlotSummary']

const now = Date.parse('2026-10-17T12:00:00Z')
const slot = (state: SlotSummary['state'], long_missing = false): SlotSummary => ({ version_id: 1, profile: 'hd-primary', state, long_missing })
const grab = (over: Partial<QueueItem> = {}): QueueItem => ({
  grab_id: 1,
  title_id: 1,
  has_poster: false,
  version_id: 1,
  title: 'x',
  year: null,
  kind: 'movie',
  slot: 'standard',
  episodes: [],
  release_name: 'X.1080p-GRP',
  indexer: 'Fake',
  size: 100,
  score: 0,
  phase: 'downloading',
  phase_since: '2026-10-17T11:00:00Z',
  grabbed_at: '2026-10-17T11:00:00Z',
  bytes_total: 100,
  bytes_left: 36,
  eta: 360,
  is_upgrade: false,
  score_delta: null,
  stuck: null,
  ...over,
})

describe('the state line of a Library row', () => {
  it('says how long a Long Missing Movie has been Wanted, in red', () => {
    const r = row(1, 'Shore', 'Shore', { slots: { standard: slot('wanted', true), '4k': null }, wanted_since: '2026-07-13T12:00:00Z' })
    expect(stateLine(r, [], now)).toEqual({ text: 'Long Missing · Wanted for 96 days', tone: 'error' })
    expect(posterBadge(r, [])).toEqual({ label: 'Long Missing', tone: 'error' })
  })

  it('says how long a Movie has been Wanted and when Kestrel last looked', () => {
    const r = row(1, 'Cranes', 'Cranes', { wanted_since: '2026-10-05T12:00:00Z', searched_at: '2026-10-01T12:00:00Z' })
    expect(stateLine(r, [], now)).toEqual({ text: 'Wanted for 12 days · last searched 16 d ago', tone: 'warning' })
  })

  it("follows a Movie's Grab with its Slot, progress and time left, and shows its dot downloading", () => {
    const r = row(1, 'Orbit', 'Orbit', { slots: { standard: slot('filled'), '4k': slot('wanted') } })
    const g = [grab({ slot: '4k' })]
    expect(stateLine(r, g, now)).toEqual({ text: '4K downloading · 64% · 6 min left', tone: 'info' })
    expect(shownSlots(r, g)['4k']?.state).toBe('downloading')
    expect(posterBadge(r, g)).toEqual({ label: '64%', tone: 'info' })
    // An Upgrade leaves a filled dot filled.
    expect(shownSlots(r, [grab({ is_upgrade: true })]).standard?.state).toBe('filled')
  })

  it("counts a Series' Wanted episodes by season, with those downloading", () => {
    const r = row(1, 'Harbour', 'Harbour', { kind: 'series', wanted_episodes: { wanted: 3, long_missing: 0, seasons: [2] } })
    const g = [grab({ kind: 'series', episodes: ['S02E04'] })]
    expect(stateLine(r, g, now)).toEqual({ text: 'S02: 3 Wanted, 1 downloading', tone: 'warning' })
    const long = row(2, 'Lantern', 'Lantern', { kind: 'series', wanted_episodes: { wanted: 6, long_missing: 2, seasons: [1, 2, 3, 4] } })
    expect(stateLine(long, [], now)).toEqual({ text: 'Long Missing · 4 seasons: 6 Wanted', tone: 'error' })
  })

  it('names the episodes a Series Grab brings when nothing else is Wanted', () => {
    const r = row(1, 'Copper', 'Copper', { kind: 'series', slots: { standard: slot('filled'), '4k': null }, wanted_episodes: { wanted: 0, long_missing: 0, seasons: [] } })
    expect(stateLine(r, [grab({ kind: 'series', episodes: ['S03E07'], bytes_left: 59, eta: null })], now)).toEqual({ text: 'S03E07 downloading · 41%', tone: 'info' })
  })

  it('says what a Title that wants nothing holds', () => {
    const both = row(1, 'Static', 'Static', { slots: { standard: slot('filled'), '4k': slot('filled') }, wanted_since: null, size: 3 * 1024 ** 3, added_at: '2026-01-01T00:00:00Z' })
    expect(stateLine(both, [], now, { size: true }).text).toBe('Standard & 4K · 3.0 GB')
    const translated = row(2, 'Salt and Iron', 'Sel et fer', { slots: { standard: slot('filled'), '4k': null }, wanted_since: null, added_at: '2026-10-16T12:00:00Z' })
    expect(stateLine(translated, [], now)).toEqual({ text: 'Sel et fer · added 1 d ago', tone: 'quiet' })
    expect(stateLine(row(3, 'Glass', 'Glass', { slots: { standard: slot('unreleased'), '4k': null }, wanted_since: null }), [], now).text).toBe('Not out yet')
    expect(stateLine(row(4, 'Wren', 'Wren', { slots: { standard: slot('unmonitored'), '4k': null }, wanted_since: null }), [], now).text).toBe('Unmonitored')
  })
})
