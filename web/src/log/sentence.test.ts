import { describe, expect, it } from 'vitest'
import type { LogEvent } from '../api/log'
import { causeText, triggerText } from './trigger'
import { actionOf, foldSummary, kindNames, recoveriesByKey, recoveryAfter, recoveryOf, searchResult, sentence, sentenceText, severityOf, whyText } from './sentence'

const ev = (kind: string, message: string, data: LogEvent['data'] = null, over: Partial<LogEvent> = {}): LogEvent => ({
  id: 1,
  at: '2026-10-17T12:00:00Z',
  kind,
  routine: false,
  title_id: 3,
  version_id: null,
  episode_id: null,
  grab_id: null,
  request_id: null,
  message,
  trigger: null,
  reason: '',
  data,
  ...over,
})

const text = (e: LogEvent, title?: string) => sentenceText(sentence(e, title))

describe('the sentence of each kind the server records', () => {
  const R = 'Paddington.2014.1080p.BluRay.x264-GRP'
  const cases: [string, LogEvent, string, string?][] = [
    ['grab', ev('grab', `Sent ${R} to the download client`, { by: 'by_search' }), `Grabbed Paddington · ${R} · found by a search`],
    ['grab by hand', ev('grab', `Sent ${R} to the download client`, { by: 'by_hand' }), `Grabbed Paddington · ${R} · chosen by hand`],
    ['grab from before the payload', ev('grab', `Sent ${R} to the download client`), `Grabbed Paddington · ${R}`],
    ['grab_downloading', ev('grab_downloading', `Download started: ${R}`, null, { routine: true }), `Download started Paddington · ${R}`],
    ['grab_completed', ev('grab_completed', `Download finished: ${R}`, null, { routine: true }), `Download finished Paddington · ${R}`],
    ['grab_failed by the client', ev('grab_failed', `Download failed (encrypted): ${R}`), `Download failed Paddington · encrypted · ${R}`],
    ['grab_failed discarded', ev('grab_failed', `Discarded the stalled Import of ${R}`), `Discarded the stalled Import of Paddington · ${R}`],
    ['grab_canceled', ev('grab_canceled', `Canceled ${R}`), `Canceled Paddington · ${R}`],
    ['import', ev('import', `Imported ${R} as /data/media/movies/Paddington (2014)/Paddington.mkv`, { path: '/x' }), `Imported Paddington · ${R}`],
    [
      'import with an inconclusive probe',
      ev('import', `Imported ${R} as /x.mkv (probe inconclusive: the parsed languages stand)`),
      `Imported Paddington · ${R} · languages not confirmed by the probe`,
    ],
    ['import_rejected', ev('import_rejected', `Import of ${R} rejected: not_upgrade`), `Import rejected Paddington · not an upgrade · ${R}`],
    ['import_stalled', ev('import_stalled', `Import of ${R} stalled: disk full`), `Import stalled Paddington · disk full · ${R}`],
    ['import_episode imported', ev('import_episode', 'S01E02: imported as /tv/x.mkv', { status: 'imported', file: 'x.mkv', path: '/tv/x.mkv' }), 'Imported Paddington · S01E02 · x.mkv'],
    ['import_episode left alone', ev('import_episode', 'S01E03: left alone (unmonitored)', { status: 'skipped', reason: 'unmonitored' }), 'Left alone Paddington · S01E03 · episode not monitored'],
    ['adoption', ev('adoption', 'Adopted Paddington (2014) in Standard, 4K'), 'Adopted Paddington · into Standard, 4K'],
    ['adoption of a Title the Library lost', ev('adoption', 'Adopted Heat (1995) in Standard'), 'Adopted Heat (1995) · into Standard', ''],
    [
      'adoption_scanned',
      ev('adoption_scanned', 'Adoption scan: 4 matched, 1 need a choice, 0 skipped', null, { routine: true, title_id: null }),
      'Adoption scan: 4 matched, 1 need a choice, 0 skipped',
    ],
    ['cleanup', ev('cleanup', 'Cleaned up 3 Unmanaged file(s), 1500000000 bytes'), 'Cleaned up Paddington · 3 Unmanaged files · 1.4 GB'],
    ['request', ev('request', 'Request from Ellie via Plex'), 'Ellie requested Paddington · through Plex'],
    ['request_ended', ev('request_ended', 'Request from Ellie via Plex ended by hand'), 'Ended the request for Paddington · from Ellie through Plex'],
    ['watch_ahead', ev('watch_ahead', 'Watch-ahead added season 3'), 'Watch-ahead added Paddington · season 3'],
    ['rename', ev('rename', 'Renamed "A" to "B" (4 files)', { from: 'A', to: 'B', files: 4 }), 'Renamed Paddington · folder A to B'],
    ['move', ev('move', 'Moved from /a to /b', { from: '/a', to: '/b' }), 'Moved Paddington · from /a to /b'],
    ['delete', ev('delete', 'Deleted Paddington.mkv (S01E02); blocklisted R'), 'Deleted Paddington · Paddington.mkv (S01E02); blocklisted R'],
    ['title_refreshed', ev('title_refreshed', 'Refreshed from the metadata providers', null, { routine: true }), 'Refreshed Paddington · from the metadata providers'],
    ['blocklist', ev('blocklist', `Blocklisted ${R}: canceled and blocklisted`), `Blocklisted Paddington · ${R} · canceled and blocklisted`],
    [
      'health_raised',
      ev('health_raised', 'SABnzbd refused the connection', { key: 'k', kind: 'download_client_unreachable', severity: 'blocking' }, { title_id: null }),
      'SABnzbd refused the connection',
    ],
    ['health_cleared', ev('health_cleared', 'Cleared: SABnzbd refused the connection', null, { title_id: null }), 'Cleared: SABnzbd refused the connection'],
    ['search found nothing', ev('search', 'Searched by hand for S05 in 4K: nothing to grab', null, { routine: true }), 'Searched Paddington · S05 · 4K · nothing to grab'],
    ['an automatic search', ev('search', 'Searched in Standard: nothing to grab', null, { routine: true }), 'Searched Paddington · Standard · nothing to grab'],
    ['an automatic Upgrade search', ev('search', 'Searched for Upgrades in 4K: grabbed 1 Release', null, { routine: true }), 'Searched Paddington · Upgrades · 4K · grabbed 1 Release'],
    ['search of a whole Title', ev('search', 'Searched by hand in Standard: grabbed 1 Release', null, { routine: true }), 'Searched Paddington · Standard · grabbed 1 Release'],
    [
      'search with what it checked and grabbed',
      ev('search', 'Searched by hand for S05 in 4K: grabbed 1 Release', { scope: 'S05', slot: '4K', releases: 37, grabbed: 1, result: 'grabbed' }, { routine: true }),
      'Searched Paddington · S05 · 4K · 37 releases · 1 Grab',
    ],
    [
      'search where nothing fit',
      ev('search', 'Searched by hand in Standard: nothing to grab', { scope: '', slot: 'Standard', releases: 23, grabbed: 0, result: 'nothing_fit' }, { routine: true }),
      'Searched Paddington · Standard · 23 releases · none fit',
    ],
    ['search that failed', ev('search', 'Searched by hand in Standard and failed: indexers down', null, { routine: true }), 'Searched Paddington · Standard · failed: indexers down'],
    [
      'original_offered',
      ev('original_offered', 'Standard has the Original Language only: accept or dismiss it in Needs attention', null, { routine: true }),
      'Offered the Original Language only Paddington · Standard · accept or dismiss it in Needs attention',
    ],
  ]
  it.each(cases)('%s', (_, e, want, title = 'Paddington') => expect(text(e, title || undefined)).toBe(want))

  it('has a name and a sentence for every kind of the server', () => {
    const kinds = Object.keys(kindNames)
    expect(kinds).toHaveLength(50)
    for (const kind of kinds) expect(sentence(ev(kind, 'x'), 'T').verb).not.toBe('')
  })

  it('leaves a message it does not understand as it is, and an unknown kind too', () => {
    expect(sentence(ev('import_rejected', 'Something else'), 'T')).toMatchObject({ verb: 'Something else', severity: 'error' })
    expect(sentence(ev('mystery', 'It happened'), 'T')).toMatchObject({ verb: 'It happened', severity: 'plain', icon: 'event' })
  })

  it('colours errors and warnings by kind and leaves the rest plain', () => {
    for (const k of ['grab_failed', 'import_rejected', 'blocklist']) expect(severityOf(k)).toBe('error')
    for (const k of ['import_stalled', 'health_raised', 'original_offered']) expect(severityOf(k)).toBe('warning')
    expect(severityOf('grab')).toBe('plain')
    expect(sentence(ev('grab_failed', 'Download failed (x): R'), 'T').severity).toBe('error')
  })
})

describe('the one action of an event', () => {
  it('goes to the place that puts a Health check right, and to Health for a check it does not know', () => {
    const h = (kind: string) => ev('health_raised', 'x', { kind }, { title_id: null })
    expect(actionOf(h('download_client_unreachable'))).toEqual({ label: 'Open Download Settings', path: '/settings/download-client' })
    expect(actionOf(h('indexer_failing'))).toEqual({ label: 'Open Indexers', path: '/settings/indexers' })
    expect(actionOf(h('slot_rename_failed'))).toEqual({ label: 'Open Slots & Profiles', path: '/settings/slots-profiles' })
    expect(actionOf(h('something_new'))).toEqual({ label: 'Open Health', path: '/health' })
  })

  it('opens the Title of an event about one, offering a Manual search when a search found nothing', () => {
    expect(actionOf(ev('import', 'Imported R as /x'))).toEqual({ label: 'Open', title: 3 })
    // Without a Version to search an event only opens the Title.
    expect(actionOf(ev('search', 'Searched by hand in Standard: nothing to grab'))).toEqual({ label: 'Open', title: 3 })
    expect(actionOf(ev('search', 'Searched in Standard: nothing to grab', null, { version_id: 9 }))).toEqual({ label: 'Manual Search', path: '/library/3/search?version=9' })
    expect(actionOf(ev('search', 'Searched by hand for S05 in 4K: nothing to grab', { scope: 'S05' }, { version_id: 9 }))).toEqual({
      label: 'Manual Search',
      path: '/library/3/search?version=9&scope=S05',
    })
    expect(actionOf(ev('search', 'Searched by hand for S01E02 in 4K: nothing to grab', null, { version_id: 9 }))).toEqual({ label: 'Manual Search', path: '/library/3/search?version=9&scope=S01E02' })
    expect(actionOf(ev('search', 'Searched for Upgrades in 4K: nothing to grab', null, { version_id: 9 }))).toEqual({ label: 'Manual Search', path: '/library/3/search?version=9' })
    expect(actionOf(ev('health_cleared', 'Cleared: x', null, { title_id: null }))).toBeNull()
  })
})

describe('a search message', () => {
  it('is read into scope, Slot, result and Grabs', () => {
    expect(searchResult('Searched by hand for S01E02 in Standard: grabbed 2 Releases; 1 indexer did not answer')).toEqual({
      scope: 'S01E02',
      slot: 'Standard',
      result: 'grabbed 2 Releases; 1 indexer did not answer',
      grabbed: 2,
    })
    expect(searchResult('something else')).toBeNull()
  })
})

describe('the summary of a fold', () => {
  it('counts each routine kind and adds the Grabs its searches made', () => {
    const search = (n: number, m: string) => ev('search', m, null, { id: n, routine: true })
    expect(
      foldSummary([
        search(1, 'Searched by hand in Standard: grabbed 1 Release'),
        search(2, 'Searched by hand in Standard: nothing to grab'),
        ev('grab_downloading', 'Download started: R', null, { routine: true }),
      ]),
    ).toBe('2 searches · 1 download started · 1 Grab')
  })
})

describe('a fold of searches that recorded what they checked', () => {
  const search = (n: number, data: Record<string, unknown>) => ev('search', 'Searched by hand in Standard: nothing to grab', data, { id: n, routine: true })

  it('adds up the Releases they checked and the Grabs they made', () => {
    expect(foldSummary([search(1, { releases: 37, grabbed: 1 }), search(2, { releases: 381, grabbed: 0 }), ev('grab_downloading', 'Download started: R', null, { id: 3, routine: true })])).toBe(
      '2 searches · 1 download started · 418 releases checked · 1 Grab',
    )
  })

  it('leaves the Releases out for searches from before they were recorded', () => {
    expect(foldSummary([search(1, {}), search(2, {})].map((e) => ({ ...e, data: null })))).toBe('2 searches')
  })
})

describe('why a Release was grabbed', () => {
  it('names who chose it, what it covers and what it replaces at what gain', () => {
    expect(whyText('by_search', { covers_wanted: 6, replaces_files: 4, score_delta: 250 })).toBe('Search pass · covers 6 Wanted, replaces 4 at +250')
    expect(whyText('by_hand', { covers_wanted: 1, replaces_files: 0, score_delta: 0 })).toBe('By hand · covers 1 Wanted')
    expect(whyText('by_rss', { covers_wanted: 0, replaces_files: 1, score_delta: -30 })).toBe('RSS sweep · replaces 1 at −30')
  })

  it('says only what it knows', () => {
    expect(whyText('by_search', null)).toBe('Search pass')
    expect(whyText(null, { covers_wanted: 2, replaces_files: 0, score_delta: 0 })).toBe('covers 2 Wanted')
    expect(whyText(undefined, undefined)).toBeNull()
  })
})

describe('a connection that failed and came back', () => {
  const raised = ev('health_raised', 'SABnzbd refused the connection', { key: 'download_client' }, { id: 5 })
  const cleared = ev(
    'health_cleared',
    'Cleared: SABnzbd refused the connection',
    {
      key: 'download_client',
      attempts: ['2026-10-17T12:12:00Z', '2026-10-17T12:13:00Z', '2026-10-17T12:14:00Z'],
      recovered_at: '2026-10-17T12:15:00Z',
      waited: 2,
      lost: 0,
    },
    { id: 8 },
  )

  it('reads its retries, the recovery time and the Grabs held up from the event that cleared it', () => {
    expect(recoveryOf(cleared)).toEqual({ attempts: ['2026-10-17T12:12:00Z', '2026-10-17T12:13:00Z', '2026-10-17T12:14:00Z'], recoveredAt: '2026-10-17T12:15:00Z', waited: 2, lost: 0 })
    expect(recoveryOf(ev('health_cleared', 'Cleared: x', { key: 'exdev' }))).toBeNull()
  })

  it('finds the recovery after the raised event, not one before it', () => {
    const byKey = recoveriesByKey([ev('health_cleared', 'old', { ...(cleared.data as object) }, { id: 2 }), cleared])
    expect(recoveryAfter(raised, byKey)?.waited).toBe(2)
    expect(recoveryAfter({ ...raised, id: 9 }, byKey)).toBeNull()
  })

  it('adds the retries to the sentence of the raised event', () => {
    const s = sentence(raised, undefined, recoveryOf(cleared))
    expect(sentenceText(s)).toMatch(/^SABnzbd refused the connection · Kestrel retried 3 times, then it came back at \d\d:\d\d$/)
    expect(sentenceText(sentence(raised))).toBe('SABnzbd refused the connection')
  })
})

describe('the trigger and reason of an entry, in words', () => {
  const cause = (trigger: LogEvent['trigger']) => triggerText(trigger)

  it('names a person with the call, and a job or rule by what it is', () => {
    expect(cause({ kind: 'person', actor: 'Navi', via: 'updateSettings' })).toBe('Navi · update settings')
    expect(cause({ kind: 'api_key', actor: null, via: 'bulkTitles' })).toBe('The API key · bulk titles')
    expect(cause({ kind: 'sweep', actor: null, via: null })).toBe('The search sweep')
    expect(cause({ kind: 'rss', actor: null, via: null })).toBe('The RSS sweep')
    expect(cause({ kind: 'retry', actor: null, via: null })).toBe('A retry')
    expect(cause({ kind: 'request', actor: null, via: 'Plex' })).toBe('A Request from plex')
    expect(cause({ kind: 'rule', actor: null, via: 'watch ahead' })).toBe('The watch ahead rule')
    expect(cause({ kind: 'job', actor: null, via: 'refresh' })).toBe('The refresh job')
  })

  it('reads a kind it does not know as that kind, and an entry without a trigger as none', () => {
    expect(cause({ kind: 'new_thing', actor: null, via: null })).toBe('new thing')
    expect(cause(null)).toBeNull()
    expect(causeText({ trigger: null, reason: '' })).toBeNull()
    expect(causeText({ trigger: { kind: 'sweep', actor: null, via: null }, reason: 'due: 3 days after it became Wanted' })).toBe('The search sweep · due: 3 days after it became Wanted')
  })

  it('reads the Library, Placeholder and misfit kinds as sentences', () => {
    expect(text(ev('title_added', 'Added Movie "Paddington" to the Library with 2 Versions'), 'Paddington')).toBe('Added Paddington to the Library with 2 Versions')
    expect(text(ev('version_added', 'Added a 4k Version under Remux to Movie "Paddington"'), 'Paddington')).toBe('Added a Version to Paddington · 4k · Remux')
    expect(text(ev('version_removed', 'Removed the 4k Version under Remux from Movie "Paddington", with 1 file'), 'Paddington')).toBe('Removed a Version from Paddington · 4k · Remux · 1 file')
    expect(text(ev('placeholder', 'Added a Placeholder Episode for S01E02'), 'Breaking Bad')).toBe('Placeholder Episode added Breaking Bad · S01E02')
    expect(text(ev('file_misfit', 'Marked Paddington.mkv as a misfit'), 'Paddington')).toBe('Marked a misfit Paddington · Paddington.mkv')
  })
})
