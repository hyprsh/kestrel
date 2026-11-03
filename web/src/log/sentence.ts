// The Log's events as plain-English sentences, one formatter per kind the server records (internal/history). An event
// stores a message the server wrote, ids of what it is about and, for some kinds, a small payload; the sentence is built
// from those and from the Title's name (the Library knows it), so what an event does not hold is left out, never guessed.
// A message that does not read as the formatter expects falls back to being shown as it is.
import type { LogEvent } from '../api/log'
import { bytesText } from '../format'
import { manualSearchPath } from '../place'
import { rejectionText } from '../rejection'
import { clock } from './rows'

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The words for who chose a Grab's Release (the `by` of its payload). */
function chosenBy(by: unknown): string | null {
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

/** The chooser as the Grab's Why starts: "Search pass", "By hand", "RSS sweep". */
const choosers: Record<string, string> = { by_search: 'Search pass', by_hand: 'By hand', by_rss: 'RSS sweep' }

/** What a Grab's Why holds: how many Wanted it covers, how many files it replaces and the average Score gain over them. */
export type Why = { covers_wanted: number; replaces_files: number; score_delta: number }

/**
 * Why a Release was grabbed: "Search pass · covers 6 Wanted, replaces 4 at +250". `by` is who chose it (the Grab event's payload),
 * `why` what the Grab records of it; either may be missing, and null comes back when neither says anything.
 */
export function whyText(by: unknown, why: Why | null | undefined): string | null {
  const chooser = typeof by === 'string' ? choosers[by] : undefined
  const parts: string[] = []
  if (why) {
    if (why.covers_wanted > 0) parts.push(`covers ${why.covers_wanted} Wanted`)
    if (why.replaces_files > 0) parts.push(`replaces ${why.replaces_files}${why.score_delta !== 0 ? ` at ${why.score_delta > 0 ? '+' : '−'}${Math.abs(why.score_delta).toLocaleString()}` : ''}`)
  }
  const reason = parts.join(', ')
  return [chooser, reason].filter(Boolean).join(' · ') || null
}

/** What a failing connection did before it came back, from the `health_cleared` event that closed its row. */
export type Recovery = { attempts: string[]; recoveredAt: string; waited?: number; lost?: number }

/** The recovery a `health_cleared` event records, or null for one that cleared a row that was not a connection outage. */
export function recoveryOf(e: LogEvent): Recovery | null {
  const d = (e.data ?? {}) as Record<string, unknown>
  if (!Array.isArray(d.attempts) || d.attempts.length === 0 || typeof d.recovered_at !== 'string') return null
  return {
    attempts: d.attempts.filter((a): a is string => typeof a === 'string'),
    recoveredAt: d.recovered_at,
    ...(typeof d.waited === 'number' && { waited: d.waited }),
    ...(typeof d.lost === 'number' && { lost: d.lost }),
  }
}

/** The recoveries by the Needs attention key of the row they closed, newest first events in, so an older recovery wins for an older outage. */
export function recoveriesByKey(cleared: readonly LogEvent[]): Map<string, LogEvent[]> {
  const out = new Map<string, LogEvent[]>()
  for (const e of cleared) {
    const key = str((e.data as Record<string, unknown> | null)?.key)
    if (key && recoveryOf(e)) out.set(key, [...(out.get(key) ?? []), e])
  }
  return out
}

/** The recovery that closed the outage a `health_raised` event opened: the first recovery of its key after it. */
export function recoveryAfter(raised: LogEvent, byKey: ReadonlyMap<string, LogEvent[]>): Recovery | null {
  const key = str((raised.data as Record<string, unknown> | null)?.key)
  const closing = key
    ? byKey
        .get(key)
        ?.filter((c) => c.id > raised.id)
        .at(-1)
    : undefined
  return closing ? recoveryOf(closing) : null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** `·`-joins the parts that are there, with a leading `·` for a sentence that goes on after the Title. */
const details = (...parts: (string | undefined | false)[]) => {
  const kept = parts.filter((p): p is string => !!p)
  return kept.length > 0 ? `· ${kept.join(' · ')}` : ''
}

/** What a Searched event's message says: its scope (`S05`, `S01E02`), Slot and result. */
export type SearchResult = { scope: string; slot: string; result: string; grabbed: number }

/**
 * Reads "Searched by hand for S05 in 4K: grabbed 2 Releases; 1 indexer did not answer", and the searches Kestrel runs on
 * its own: "Searched in Standard: nothing to grab", "Searched for Upgrades in 4K: grabbed 1 Release". Null when it does not read so.
 */
export function searchResult(message: string): SearchResult | null {
  const m = /^Searched(?: by hand| for (Upgrades))?(?: for (.+?))? in (.+?)(?::| and failed:)(.*)$/.exec(message)
  if (!m) return null
  const failed = / and failed:/.test(message)
  const tail = m[4].trim()
  const grabbed = Number(/grabbed (\d+) Release/.exec(tail)?.[1] ?? 0)
  return { scope: m[2] ?? m[1] ?? '', slot: m[3], result: failed ? `failed: ${tail}` : tail, grabbed }
}

/** The words for how a search ended, after its Releases: "1 Grab", "none fit". */
export function searchEnd(data: Record<string, unknown>): string | undefined {
  const grabbed = typeof data.grabbed === 'number' ? data.grabbed : 0
  if (grabbed > 0) return plural(grabbed, 'Grab')
  switch (data.result) {
    case 'nothing_fit':
      return 'none fit'
    case 'no_indexer':
      return 'no indexer'
    case 'error':
      return 'failed'
    default:
      return undefined
  }
}

/**
 * What a Searched event says, as the parts of its line: scope, Slot, Releases and the end ("S05 · 4K · 37 releases · 1 Grab").
 * The payload has them; an event from before it only has the message, which is then all there is.
 */
export function searchParts(e: LogEvent): string[] {
  const data = (e.data ?? {}) as Record<string, unknown>
  const r = searchResult(e.message)
  if (!r) return [e.message]
  const releases = typeof data.releases === 'number' ? plural(data.releases, 'release') : undefined
  const end = releases ? searchEnd(data) : undefined
  return [str(data.scope) ?? r.scope, str(data.slot) ?? r.slot, releases ?? r.result, end].filter((p): p is string => !!p)
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
export function sentence(e: LogEvent, title?: string, recovery?: Recovery | null): Sentence {
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
      return m2 ? make('Import rejected', 'error', details(rejectionText(m2[2]), m2[1])) : make(m, 'error', '', 'error', false)
    }
    case 'import_stalled': {
      const m2 = /^Import of (.+?) stalled: (.+)$/.exec(m)
      return m2 ? make('Import stalled', 'warning', details(m2[2], m2[1])) : make(m, 'warning', '', 'warning', false)
    }
    case 'import_episode': {
      const code = /^(S\d+E\d+|[^:]+): /.exec(m)?.[1]
      if (data.status === 'imported' || / imported as /.test(m)) return make('Imported', 'import', details(code, str(data.file)))
      const reason = str(data.reason) ?? /\((.+)\)$/.exec(m)?.[1]
      return make('Left alone', 'event', details(code, reason === undefined ? reason : rejectionText(reason)))
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
    case 'health_raised': {
      const back = recovery ? `· Kestrel retried ${plural(recovery.attempts.length, 'time')}, then it came back at ${clock(recovery.recoveredAt)}` : ''
      return make(m, 'warning', back, 'warning', false)
    }
    case 'health_cleared':
      return make(m, 'done', '', 'plain', false)
    case 'search': {
      const r = searchResult(m)
      if (!r) return make('Searched', 'search', details(m))
      return make('Searched', 'search', details(...searchParts(e)), r.result.startsWith('failed') ? 'warning' : 'plain')
    }
    case 'original_offered': {
      const m2 = /^(.+?) has the Original Language only: (.+)$/.exec(m)
      return m2 ? make('Offered the Original Language only', 'warning', details(m2[1], m2[2]), 'warning') : make(m, 'warning', '', 'warning', false)
    }
    case 'title_added': {
      const versions = /with (.+)$/.exec(m)?.[1]
      return title ? make('Added', 'event', `to the Library${versions ? ` with ${versions}` : ''}`) : make(m, 'event', '', 'plain', false)
    }
    case 'version_added': {
      const m2 = /^Added a (.+?) Version under (.+?) to /.exec(m)
      return m2 ? make('Added a Version to', 'event', details(m2[1], m2[2])) : make(m, 'event', '', 'plain', false)
    }
    case 'version_removed': {
      const m2 = /^Removed the (.+?) Version under (.+?) from .+?, with (.+)$/.exec(m)
      return m2 ? make('Removed a Version from', 'delete', details(m2[1], m2[2], m2[3])) : make(m, 'delete', '', 'plain', false)
    }
    case 'monitoring':
      return make('Monitoring changed', 'event', details(m))
    case 'placeholder': {
      const code = /for (S\d+E\d+)$/.exec(m)?.[1]
      return make('Placeholder Episode added', 'event', details(code))
    }
    case 'file_misfit':
      return make('Marked a misfit', 'warning', details(/^Marked (.+) as a misfit$/.exec(m)?.[1] ?? m), 'plain')
    case 'file_rescored':
      return make('Re-scored', 'refresh', details(/^Re-scored (.+)$/.exec(m)?.[1] ?? m))
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
  placeholder: 'Placeholder Episode',
  file_misfit: 'Misfit file',
  file_rescored: 'File re-scored',
  indexer_paused: 'Indexer paused',
  indexer_backed_off: 'Indexer backed off',
  indexer_slow: 'Indexer slow',
  indexer_sweep_stopped: 'Sweeps stopped',
  indexer_recovered: 'Indexer recovered',
  search_skipped: 'Search skipped',
  title_added: 'Title added',
  title_removed: 'Title removed',
  version_added: 'Version added',
  version_removed: 'Version removed',
  monitoring: 'Monitoring',
  profile_created: 'Profile created',
  profile_changed: 'Profile changed',
  profile_deleted: 'Profile deleted',
  slot_created: 'Slot created',
  slot_changed: 'Slot changed',
  slot_deleted: 'Slot deleted',
  slots_preset: 'Slot preset',
  settings_changed: 'Settings changed',
  grabs_paused: 'Grabs paused',
  grabs_resumed: 'Grabs resumed',
  blocklist_removed: 'Blocklist entry removed',
  bulk: 'Bulk action',
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
  slot_rename_failed: { label: 'Open Slots & Profiles', path: '/settings/slots-profiles' },
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
  if (e.title_id != null) {
    // A search that found nothing to grab opens that Version's Manual search, narrowed to the scope the search covered.
    if (e.kind === 'search' && e.message.includes('nothing to grab') && e.version_id != null) {
      const scope = str((e.data as Record<string, unknown> | null)?.scope) ?? searchResult(e.message)?.scope
      return { label: 'Manual Search', path: manualSearchPath({ titleId: e.title_id, versionId: e.version_id, scope: scope && /^S\d+(E\d+)?$/i.test(scope) ? scope.toUpperCase() : null }) }
    }
    return { label: 'Open', title: e.title_id }
  }
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

/**
 * "12 searches · 418 releases checked · 1 Grab" for a run of routine events: the Releases its searches checked and the Grabs
 * they made. An event from before those were recorded adds none to the Releases, and its Grabs come from its message.
 */
export function foldSummary(events: readonly LogEvent[]): string {
  const counts = new Map<string, number>()
  let grabbed = 0
  let checked = 0
  for (const e of events) {
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
    if (e.kind !== 'search') continue
    const data = (e.data ?? {}) as Record<string, unknown>
    checked += typeof data.releases === 'number' ? data.releases : 0
    grabbed += typeof data.grabbed === 'number' ? data.grabbed : (searchResult(e.message)?.grabbed ?? 0)
  }
  const parts = [...counts].map(([kind, n]) => (foldNames[kind] ? `${n} ${foldNames[kind][n === 1 ? 0 : 1]}` : plural(n, kindNames[kind]?.toLowerCase() ?? kind)))
  if (checked > 0) parts.push(`${checked.toLocaleString()} ${checked === 1 ? 'release' : 'releases'} checked`)
  if (grabbed > 0) parts.push(plural(grabbed, 'Grab'))
  return parts.join(' · ')
}

/** The plain words of a sentence, for a label or a copy. */
export const sentenceText = (s: Sentence): string => [s.verb, s.title, s.rest].filter(Boolean).join(' ')
