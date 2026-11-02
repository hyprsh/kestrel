import { describe, expect, it } from 'vitest'
import { dayName } from './TitleBadges'
import { monitoringChip } from './KestrelChips'
import type { TitleDetail, TitleRow } from '../api/queries'

const now = new Date('2026-11-02T12:00:00').getTime()

describe('the Kestrel chips of a Title header', () => {
  it('adds the year to a release date outside the current year only', () => {
    expect(dayName('2026-11-07', now)).toBe('Sat, Nov 7')
    expect(dayName('2019-11-07', now)).toBe('Thu, Nov 7, 2019')
    expect(dayName('2027-01-15', now)).toBe('Fri, Jan 15, 2027')
  })

  it('says Not monitored, Upgrading to Cutoff or At Cutoff', () => {
    const movie = (monitored: boolean) => ({ kind: 'movie', monitored, versions: [{ file: { path: '/a' } }] }) as unknown as TitleDetail
    const row = (upgrade: boolean) => ({ slot_states: [{ state: 'filled', upgrade_wanted: upgrade }] }) as unknown as TitleRow
    expect(monitoringChip(movie(false), row(false))).toBe('Not monitored')
    expect(monitoringChip(movie(true), row(true))).toBe('Upgrading to Cutoff')
    expect(monitoringChip(movie(true), row(false))).toBe('At Cutoff')
    expect(monitoringChip({ kind: 'movie', monitored: true, versions: [{ file: null }] } as unknown as TitleDetail, undefined)).toBe('Monitored')
  })

  it('says At Cutoff only when every Slot is filled, not while something is still Wanted or downloading', () => {
    const series = { kind: 'series', monitored: true, series_monitor: 'all', versions: [{ state: 'wanted', coverage: { filled: 50 } }] } as unknown as TitleDetail
    const row = (...states: string[]) => ({ slot_states: states.map((state) => ({ state, upgrade_wanted: false })) }) as unknown as TitleRow
    expect(monitoringChip(series, row('downloading', 'wanted'))).toBe('Monitored')
    expect(monitoringChip(series, row('filled', 'wanted'))).toBe('Monitored')
    expect(monitoringChip(series, row('filled', 'filled'))).toBe('At Cutoff')
    expect(monitoringChip(series, undefined)).toBe('Monitored')
  })
})
