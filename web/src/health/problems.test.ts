// The verdict's sentences: what is wrong, since when, what it stops, and where it gets fixed.
import { describe, expect, it } from 'vitest'
import type { AttentionAction, AttentionRow, SystemStatus } from '../api/attention'
import { clockTime } from '../time'
import { fixLabel, headline, problemsOf } from './problems'

const now = Date.parse('2026-11-01T15:00:00')
const open: AttentionAction = { key: 'open', label: 'Open in Settings', method: 'GET', path: '/settings/indexers', body: null, confirm: null }
const test: AttentionAction = { key: 'test', label: 'Test', method: 'POST', path: '/plugin-instances/12/test', body: null, confirm: null }
const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  id: 'health-1',
  severity: 'blocking',
  kind: 'indexer_failing',
  subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: 12 },
  message: "altHUB rejected Kestrel's API key",
  since: '2026-11-01T12:12:00',
  count: 1,
  actions: [test, open],
  ...over,
})
const status = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '1.8.2',
  started_at: '2026-10-25T10:00:00Z',
  services: [],
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [],
  disks: [],
  trash: { commit: 'abc', committed_at: null, checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})

describe('problemsOf', () => {
  it('says what is wrong, since when and what it affects, and goes to the Settings page that fixes it', () => {
    const [p] = problemsOf([row()], undefined, now)
    expect(p.sentence).toBe(`altHUB rejected Kestrel's API key, since ${clockTime('2026-11-01T12:12:00')}. Searches skip it until it is fixed.`)
    expect(p.action).toBe(open)
    expect(fixLabel(p.action!)).toBe('Fix in Settings')
  })

  it("takes the row's own action when none opens Settings, and keeps a kind it does not know to its message", () => {
    const [p] = problemsOf([row({ kind: 'something_new', message: 'Something broke.', actions: [test] })], undefined, now)
    expect(p.sentence).toBe(`Something broke, since ${clockTime('2026-11-01T12:12:00')}.`)
    expect(p.action).toBe(test)
    expect(fixLabel(test)).toBe('Test')
  })

  it('puts a drifting clock in the verdict as a warning, with what it throws off', () => {
    const log: AttentionAction = { key: 'log', label: 'Show in the Log', method: 'GET', path: '/log?q=kind:health_raised', body: null, confirm: null }
    const [p] = problemsOf([row({ kind: 'clock_drift', severity: 'warning', message: "The server's clock is 3 min behind TMDB's", actions: [log] })], undefined, now)
    expect(p).toMatchObject({ severity: 'warning', action: log })
    expect(p.sentence).toBe(
      `The server's clock is 3 min behind TMDB's, since ${clockTime('2026-11-01T12:12:00')}. Dates Kestrel records and the days Upcoming shows are off until the clock is put right.`,
    )
  })

  it('counts only the health rows, as the rail button does', () => {
    expect(problemsOf([row({ id: 'stuck-4', kind: 'stuck_download' })], undefined, now)).toEqual([])
  })

  it('puts problems before warnings', () => {
    const rows = [row({ id: 'health-1', severity: 'warning', kind: 'low_disk_space', message: 'Low disk space' }), row({ id: 'health-2' })]
    expect(problemsOf(rows, undefined, now).map((p) => p.severity)).toEqual(['blocking', 'warning'])
  })

  it('adds a failing download client or indexer that has no row yet, once, pointing at its Settings page', () => {
    const s = status({
      download_client: { state: 'failing', name: 'SABnzbd', instance_id: 3, message: 'connection refused', since: '2026-11-01T14:58:00' },
      indexers: [
        {
          instance_id: 12,
          name: 'altHUB',
          state: 'failing',
          message: 'bad key',
          since: '2026-11-01T12:12:00',
          search_used: 0,
          search_max: null,
          grab_used: null,
          grab_max: null,
          search_paused_until: null,
          grabs_paused: false,
          grabs_paused_until: null,
        },
      ],
    })
    const problems = problemsOf([row()], s, now)
    expect(problems).toHaveLength(2)
    expect(problems[1].sentence).toMatch(/^The download client SABnzbd: connection refused, since .*Nothing is downloaded/)
    expect(problemsOf([], status({ download_client: { state: 'failing', name: 'SABnzbd', instance_id: 3, message: 'cannot reach SABnzbd: refused', since: null } }), now)[0].sentence).toMatch(
      /^cannot reach SABnzbd: refused\. Nothing/,
    )
    expect(problems[1].action).toMatchObject({ method: 'GET', path: '/settings/download-client' })
  })
})

describe('headline', () => {
  const p = (severity: 'blocking' | 'warning') => ({ key: severity, severity, sentence: '' })
  it('counts the problems, and the warnings beside them', () => {
    expect(headline([p('blocking')])).toBe('1 problem needs you')
    expect(headline([p('blocking'), p('blocking')])).toBe('2 problems need you')
    expect(headline([p('blocking'), p('warning')])).toBe('1 problem needs you · 1 warning')
    expect(headline([p('warning')])).toBe('1 warning to look at')
  })
})
