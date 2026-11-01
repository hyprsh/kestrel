// The Log's events as plain-English sentences, one formatter per kind the server records (internal/history). An event
// stores a message the server wrote, ids of what it is about and, for some kinds, a small payload; the sentence is built
// from those and from the Title's name (the Library knows it), so what an event does not hold is left out, never guessed.
// A message that does not read as the formatter expects falls back to being shown as it is.
import type { LogEvent } from '../api/log'

/** How an event reads: red for an error, amber for a warning, plain otherwise. */
export type Severity = 'plain' | 'warning' | 'error'

/** The kinds the Log's strip and Errors and Warnings views count; internal/history SeverityOf has the same lists. */
const errors = new Set(['grab_failed', 'import_rejected', 'blocklist'])
const warnings = new Set(['import_stalled', 'health_raised', 'original_offered'])

export const severityOf = (kind: string): Severity => (errors.has(kind) ? 'error' : warnings.has(kind) ? 'warning' : 'plain')

/** The icon a row shows, by name; Log.tsx maps the names to icons. */
export type IconName =
  'grab' | 'download' | 'done' | 'error' | 'warning' | 'import' | 'request' | 'watch' | 'rename' | 'move' | 'delete' | 'refresh' | 'search' | 'adoption' | 'cleanup' | 'blocklist' | 'event'

/**
 * One event as a sentence: `verb` (coloured by `severity`), the Title (bold, a link when the event has one) and `rest`
 * (muted). `search` carries what a Searched event holds, for the folded view.
 */
export type Sentence = {
  verb: string
  severity: Severity
  /** The Title's name, bold and linking to the Title; undefined when the event is about none. */
  title?: string
  rest: string
  icon: IconName
}

/** Whole bytes as "1.4 GB". */
function bytesText(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${i === 0 || v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The words for who chose a Grab's Release (the `by` of its payload). */
export function chosenBy(by: unknown): string | null {
  switch (by) {
    case 'by_hand':
      return 'chosen by hand'
    case 'by_search':
      return 'found by a search'
    case 'by_rss':
      return 'found by the RSS sweep'
    default:
      return null
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** `·`-joins the parts that are there, with a leading `·` for a sentence that goes on after the Title. */
const details = (...parts: (string | undefined | false)[]) => {
  const kept = parts.filter((p): p is string => !!p)
  return kept.length > 0 ? `· ${kept.join(' · ')}` : ''
}

/** What a Searched event's message says: its scope (`S05`, `S01E02`), Slot and result. */
export type SearchResult = { scope: string; slot: string; result: string; grabbed: number }

/** Reads "Searched by hand for S05 in 4K: grabbed 2 Releases; 1 indexer did not answer". Null when it does not read so. */
export function searchResult(message: string): SearchResult | null {
  const m = /^Searched by hand(?: for (.+?))? in (.+?)(?::| and failed:)(.*)$/.exec(message)
  if (!m) return null
  const failed = / and failed:/.test(message)
  const tail = m[3].trim()
  const grabbed = Number(/grabbed (\d+) Release/.exec(tail)?.[1] ?? 0)
  return { scope: m[1] ?? '', slot: m[2], result: failed ? `failed: ${tail}` : tail, grabbed }
}

/** The failure of a failed Grab: "Download failed (encrypted): R" -> "encrypted". */
function failureReason(message: string): string | undefined {
  return /^Download failed \((.+?)\): /.exec(message)?.[1]
}

/** The release name of a message of the form "<prefix>R<suffix>". */
const between = (message: string, prefix: RegExp, suffix?: RegExp) => {
  const m = prefix.exec(message)
  if (!m) return undefined
  const rest = message.slice(m[0].length)
  const cut = suffix ? rest.search(suffix) : -1
  return cut >= 0 ? rest.slice(0, cut) : rest
}

/**
 * The sentence for `e`. `title` is the name of its Title, when the Library has it. Every kind the server records has a
 * case; a kind it does not know yet reads as its message.
 */
export function sentence(e: LogEvent, title?: string): Sentence {
  const data = (e.data ?? {}) as Record<string, unknown>
  const m = e.message
  const make = (verb: string, icon: IconName, rest = '', severity: Severity = severityOf(e.kind), withTitle = true): Sentence => ({
    verb,
    icon,
    rest,
    severity,
    ...(withTitle && title ? { title } : {}),
  })

  switch (e.kind) {
    case 'grab': {
      const release = between(m, /^Sent /, / to the download client$/)
      return make('Grabbed', 'grab', details(release, chosenBy(data.by) ?? undefined))
    }
    case 'grab_downloading':
      return make('Download started', 'download', details(between(m, /^Download started: /)))
    case 'grab_completed':
      return make('Download finished', 'done', details(between(m, /^Download finished: /)))
    case 'grab_failed': {
      const release = between(m, /^Download failed \(.+?\): /)
      if (release !== undefined) return make('Download failed', 'error', details(failureReason(m), release))
      const stalled = between(m, /^Discarded the stalled Import of /)
      if (stalled !== undefined) return make('Discarded the stalled Import of', 'error', details(stalled), 'error', true)
      return make(m, 'error', '', 'error', false)
    }
    case 'grab_canceled':
      return make('Canceled', 'blocklist', details(between(m, /^Canceled /)))
    case 'import': {
      const m2 = /^Imported (.+?) as (.+?)( \(probe inconclusive.*\))?$/.exec(m)
      return make('Imported', 'import', details(m2?.[1] ?? m, m2?.[3] ? 'languages not confirmed by the probe' : undefined))
    }
    case 'import_rejected': {
      const m2 = /^Import of (.+?) rejected: (.+)$/.exec(m)
      return m2 ? make('Import rejected', 'error', details(m2[2], m2[1])) : make(m, 'error', '', 'error', false)
    }
    case 'import_stalled': {
      const m2 = /^Import of (.+?) stalled: (.+)$/.exec(m)
      return m2 ? make('Import stalled', 'warning', details(m2[2], m2[1])) : make(m, 'warning', '', 'warning', false)
    }
    case 'import_episode': {
      const code = /^(S\d+E\d+|[^:]+): /.exec(m)?.[1]
      if (data.status === 'imported' || / imported as /.test(m)) return make('Imported', 'import', details(code, str(data.file)))
      const reason = str(data.reason) ?? /\((.+)\)$/.exec(m)?.[1]
      return make('Left alone', 'event', details(code, reason))
    }
    case 'adoption': {
      const slots = /\) in (.+)$/.exec(m)?.[1]
      // The Library may have lost the Title since: the message still names it.
      const named = /^Adopted (.+? \(\d+\)) in /.exec(m)?.[1]
      const s = make('Adopted', 'adoption', details(slots && `into ${slots}`))
      return title || !named ? s : { ...s, title: named }
    }
    case 'adoption_scanned':
      return make(m, 'adoption', '', 'plain', false)
    case 'cleanup': {
      const m2 = /^Cleaned up (\d+) Unmanaged file\(s\), (\d+) bytes$/.exec(m)
      return make('Cleaned up', 'cleanup', m2 ? details(plural(Number(m2[1]), 'Unmanaged file'), bytesText(Number(m2[2]))) : details(m))
    }
    case 'request': {
      const m2 = /^Request from (.+?) via (.+)$/.exec(m)
      return m2 ? make(`${m2[1]} requested`, 'request', details(`through ${m2[2]}`)) : make('Requested', 'request', details(m))
    }
    case 'request_ended': {
      const m2 = /^Request from (.+?) via (.+?) ended by hand(?:: (.+))?$/.exec(m)
      return m2 ? make('Ended the request for', 'request', details(`from ${m2[1]} through ${m2[2]}`, m2[3])) : make('Ended the request for', 'request', details(m))
    }
    case 'watch_ahead': {
      const season = /season (\d+)/.exec(m)?.[1]
      return make('Watch-ahead added', 'watch', details(season ? `season ${season}` : m))
    }
    case 'rename':
      return make('Renamed', 'rename', details(str(data.from) && str(data.to) ? `folder ${data.from} to ${data.to}` : m))
    case 'move':
      return make('Moved', 'move', details(str(data.from) && str(data.to) ? `from ${data.from} to ${data.to}` : m.replace(/^Moved /, '')))
    case 'delete': {
      const rest = m.replace(/^Deleted /, '')
      return make(/^Deleted /.test(m) ? 'Deleted' : 'Deleted files of', 'delete', details(rest), /not delete/.test(m) ? 'warning' : 'plain')
    }
    case 'title_refreshed':
      return make('Refreshed', 'refresh', details('from the metadata providers'))
    case 'blocklist': {
      const m2 = /^Blocklisted (.+?): (.+)$/.exec(m)
      return m2 ? make('Blocklisted', 'blocklist', details(m2[1], m2[2])) : make('Blocklisted', 'blocklist', details(m))
    }
    case 'health_raised':
      return make(m, 'warning', '', 'warning', false)
    case 'health_cleared':
      return make(m, 'done', '', 'plain', false)
    case 'search': {
      const r = searchResult(m)
      if (!r) return make('Searched', 'search', details(m))
      return make('Searched', 'search', details(r.scope, r.slot, r.result), r.result.startsWith('failed') ? 'warning' : 'plain')
    }
    case 'original_offered': {
      const m2 = /^(.+?) has the Original Language only: (.+)$/.exec(m)
      return m2 ? make('Offered the Original Language only', 'warning', details(m2[1], m2[2]), 'warning') : make(m, 'warning', '', 'warning', false)
    }
    default:
      return make(m, 'event', '', severityOf(e.kind), false)
  }
}

/** The words for a kind, as the opened event names it. */
export const kindNames: Record<string, string> = {
  grab: 'Grab',
  grab_downloading: 'Download started',
  grab_completed: 'Download finished',
  grab_failed: 'Grab failed',
  grab_canceled: 'Grab canceled',
  import: 'Import',
  import_episode: 'Episode Import',
  import_rejected: 'Import rejected',
  import_stalled: 'Import stalled',
  blocklist: 'Blocklist',
  request: 'Request',
  request_ended: 'Request ended',
  watch_ahead: 'Watch-ahead',
  rename: 'Rename',
  move: 'Move',
  delete: 'Files deleted',
  title_refreshed: 'Title refreshed',
  search: 'Search',
  adoption: 'Adoption',
  adoption_scanned: 'Adoption scan',
  cleanup: 'Clean up',
  health_raised: 'Needs attention',
  health_cleared: 'Needs attention cleared',
  original_offered: 'Original Offer',
}

/** What a row's one action does: open the event's Title, or go to a place of the SPA. */
export type EventAction = { label: string; title: number } | { label: string; path: string }

/** Where a Needs attention row's kind is put right, by the Health kind the event's payload carries. */
const healthPlaces: Record<string, { label: string; path: string }> = {
  download_client_unreachable: { label: 'Open Download Settings', path: '/settings/download-client' },
  no_indexer: { label: 'Open Indexers', path: '/settings/indexers' },
  indexer_failing: { label: 'Open Indexers', path: '/settings/indexers' },
  root_folder_unavailable: { label: 'Open Root Folders', path: '/settings/root-folders' },
  metadata_provider_failing: { label: 'Open Provider Keys', path: '/settings/metadata' },
  media_server_unreachable: { label: 'Open Media Servers', path: '/settings/media-servers' },
  plex_no_section: { label: 'Open Media Servers', path: '/settings/media-servers' },
  refresh_failed: { label: 'Open Media Servers', path: '/settings/media-servers' },
}

/** The one action an event offers, or none: its Health place, else its Title. */
export function actionOf(e: LogEvent): EventAction | null {
  if (e.kind === 'health_raised') {
    const place = healthPlaces[str((e.data as Record<string, unknown> | null)?.kind) ?? '']
    if (place) return place
    return { label: 'Open Health', path: '/health' }
  }
  if (e.kind === 'original_offered') return { label: 'Open Health', path: '/health' }
  if (e.kind === 'adoption_scanned') return { label: 'Open Adoption', path: '/adoption' }
  if (e.title_id != null) return { label: e.kind === 'search' && e.message.includes('nothing to grab') ? 'Manual search' : 'Open', title: e.title_id }
  return null
}

/** The routine kinds, as a count in a fold: "12 searches". */
const foldNames: Record<string, [string, string]> = {
  search: ['search', 'searches'],
  grab_downloading: ['download started', 'downloads started'],
  grab_completed: ['download finished', 'downloads finished'],
  title_refreshed: ['Title refreshed', 'Titles refreshed'],
  adoption_scanned: ['Adoption scan', 'Adoption scans'],
  original_offered: ['Original Offer', 'Original Offers'],
}

/** "12 searches · 1 Grab" for a run of routine events; the Grabs are the Releases its searches grabbed. */
export function foldSummary(events: readonly LogEvent[]): string {
  const counts = new Map<string, number>()
  let grabbed = 0
  for (const e of events) {
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
    if (e.kind === 'search') grabbed += searchResult(e.message)?.grabbed ?? 0
  }
  const parts = [...counts].map(([kind, n]) => (foldNames[kind] ? `${n} ${foldNames[kind][n === 1 ? 0 : 1]}` : plural(n, kindNames[kind]?.toLowerCase() ?? kind)))
  if (grabbed > 0) parts.push(plural(grabbed, 'Grab'))
  return parts.join(' · ')
}

/** The plain words of a sentence, for a label or a copy. */
export const sentenceText = (s: Sentence): string => [s.verb, s.title, s.rest].filter(Boolean).join(' ')
