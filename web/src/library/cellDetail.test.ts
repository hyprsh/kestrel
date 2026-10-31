import { describe, expect, it } from 'vitest'
import { queueItem } from '../test/queue'
import { cell, episode } from '../test/series'
import { cellText, grabOf, grabsByEpisode } from './cellDetail'

const now = Date.parse('2026-10-31T12:00:00Z')
const ep = (over = {}) => episode(1, 5, 5, 'Dead Freight', { air_date: '2026-10-28', ...over })
const text = (c: ReturnType<typeof cell> | null, e = ep(), grab?: ReturnType<typeof queueItem>) => cellText(c, e, grab, 'label', now)

describe('cellText', () => {
  it('says nothing for a Slot without a Version', () => {
    expect(text(null)).toBeNull()
  })

  it('gives a filled cell its file’s quality and size', () => {
    const file = { id: 1, path: '/tv/x.mkv', size: 3.2 * 1024 ** 3, quality: 'WEBDL-1080p', episode_ids: [1] }
    expect(text(cell('filled', 100, file))).toBe('WEBDL-1080p · 3.2 GB')
    expect(text(cell('filled'))).toBe('label')
  })

  it('says how long ago a Wanted episode aired', () => {
    expect(text(cell('wanted'))).toBe('Wanted · aired 3 d ago')
    expect(text(cell('wanted'), ep({ air_date: null }))).toBe('label')
  })

  it('shows a download’s progress and time left, and Importing once it is imported', () => {
    const grab = queueItem({ phase: 'downloading', bytes_total: 1000, bytes_left: 600, eta: 780 })
    expect(text(cell('downloading'), ep(), grab)).toBe('40 % · 13 min')
    expect(text(cell('downloading'), ep(), { ...grab, phase: 'importing' })).toBe('Importing')
    expect(text(cell('downloading'))).toBe('label')
  })

  it('gives an unreleased episode its air date', () => {
    expect(text(cell('unreleased'), ep({ air_date: '2026-11-04' }))).toBe('Not out yet · Nov 4')
  })
})

describe('grabsByEpisode', () => {
  it('finds the Grab of an episode by Slot and code, of the one Title only', () => {
    const grab = queueItem({ title_id: 7, slot: 'standard', episodes: ['S05E05', 'S05E06'] })
    const grabs = grabsByEpisode([grab, queueItem({ title_id: 8, slot: 'standard', episodes: ['S05E05'], grab_id: 2 })], 7)
    expect(grabOf(grabs, 'standard', ep())).toBe(grab)
    expect(grabOf(grabs, '4k', ep())).toBeUndefined()
  })
})
