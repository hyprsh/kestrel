// What an opened event shows: its stored fields as key/value pairs, and what makes one error the same as another.
// Only what the event holds is listed: its message, its payload and the Title it is about. The facts of a Grab, which the
// event does not hold, come from the Grab itself (see GrabFacts in EventDetail.tsx).
import type { LogEvent } from '../api/log'
import { plural } from '../format'
import { rejectionText } from '../rejection'
import { clock } from './rows'
import { kindNames, searchEnd, searchResult, type Recovery } from './sentence'
import { reasonText, triggerText } from './trigger'

/** One line of the opened event. `mono` is for values that are names, paths and errors; `href` makes the value a link. */
export type Field = { key: string; value: string; mono?: boolean; href?: string }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** A payload key as a label: `episode_ids` -> "Episode ids". */
const label = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** A payload value as text: a list is joined, an object is JSON. */
function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.map(valueText).join(', ')
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  return String(v)
}

/** When an event happened, in full: "Oct 30, 2026, 18:02". */
const fullTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** A time in a line of times: "Oct 30, 18:02". */
export const shortTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`

/**
 * The opened event's fields. `title` is its Title's name. The payload keys a kind's own lines did not use follow as they are,
 * so a field the server adds later shows without a change here.
 */
export function fields(e: LogEvent, title?: string, recovery?: Recovery | null): Field[] {
  const data = (e.data ?? {}) as Record<string, unknown>
  const m = e.message
  const out: Field[] = [{ key: 'Kind', value: kindNames[e.kind] ?? e.kind }]
  const used = new Set<string>()
  const add = (key: string, value: string | undefined, mono = false) => {
    if (value) out.push({ key, value, mono })
  }
  const use = (...keys: string[]) => keys.forEach((k) => used.add(k))
  if (title) add('Title', title)

  const release = (re: RegExp, suffix?: RegExp) => {
    const hit = re.exec(m)
    if (!hit) return undefined
    const rest = m.slice(hit[0].length)
    const cut = suffix ? rest.search(suffix) : -1
    return cut >= 0 ? rest.slice(0, cut) : rest
  }

  switch (e.kind) {
    case 'grab':
      add('Release', release(/^Sent /, / to the download client$/), true)
      break
    case 'grab_downloading':
      add('Release', release(/^Download started: /), true)
      break
    case 'grab_completed':
      add('Release', release(/^Download finished: /), true)
      break
    case 'grab_failed': {
      const reason = /^Download failed \((.+?)\): /.exec(m)?.[1]
      add('Release', release(/^Download failed \(.+?\): /) ?? release(/^Discarded the stalled Import of /), true)
      add('Error', reason ?? (/^Discarded/.test(m) ? 'The stalled Import was discarded' : m), true)
      break
    }
    case 'grab_canceled':
      add('Release', release(/^Canceled /), true)
      break
    case 'import': {
      const hit = /^Imported (.+?) as (.+?)( \(probe inconclusive.*\))?$/.exec(m)
      add('Release', hit?.[1], true)
      add('Path', str(data.path) ?? hit?.[2], true)
      use('path')
      if (data.probe_inconclusive) add('Languages', 'The probe was inconclusive, so the parsed languages stand')
      use('probe_inconclusive')
      break
    }
    case 'import_rejected': {
      const hit = /^Import of (.+?) rejected: (.+)$/.exec(m)
      add('Release', hit?.[1], true)
      add('Error', hit ? rejectionText(hit[2]) : m, true)
      break
    }
    case 'import_stalled': {
      const hit = /^Import of (.+?) stalled: (.+)$/.exec(m)
      add('Release', hit?.[1], true)
      add('Error', hit?.[2] ?? m, true)
      break
    }
    case 'import_episode': {
      add('Episode', /^(S\d+E\d+|[^:]+): /.exec(m)?.[1])
      add('Result', str(data.status))
      add('File', str(data.file), true)
      add('Path', str(data.path), true)
      add('Reason', rejectionText(str(data.reason) ?? ''))
      use('season', 'episode', 'status', 'file', 'path', 'reason')
      break
    }
    case 'search': {
      const r = searchResult(m)
      if (r) {
        add('Scope', r.scope || 'The whole Title')
        add('Slot', str(data.slot) ?? r.slot)
        if (typeof data.releases === 'number') add('Releases', String(data.releases))
        add('Result', (typeof data.releases === 'number' ? searchEnd(data) : undefined) ?? r.result, r.result.startsWith('failed'))
        use('scope', 'slot', 'releases', 'grabbed', 'result')
      } else add('Message', m)
      break
    }
    case 'rename':
    case 'move':
      add('From', str(data.from), true)
      add('To', str(data.to), true)
      if (typeof data.files === 'number') add('Files', String(data.files))
      use('from', 'to', 'files')
      if (!data.from) add('Message', m)
      break
    case 'delete':
      add('What', m)
      add('Paths', Array.isArray(data.paths) ? data.paths.join('\n') : undefined, true)
      if (Array.isArray(data.blocklisted) && data.blocklisted.length > 0) add('Blocklisted', data.blocklisted.join('\n'), true)
      use('paths', 'episode_ids', 'blocklisted')
      break
    case 'blocklist': {
      const hit = /^Blocklisted (.+?): (.+)$/.exec(m)
      add('Release', hit?.[1], true)
      add('Reason', hit?.[2] ?? m)
      break
    }
    case 'health_raised':
    case 'health_cleared':
      add('Message', m.replace(/^Cleared: /, ''), true)
      add('Check', str(data.kind))
      add('Key', str(data.key), true)
      add('Severity', str(data.severity))
      use('kind', 'key', 'severity', 'attempts', 'recovered_at', 'waited', 'lost')
      if (recovery) {
        add('Retries', `${recovery.attempts.map(clock).join(', ')} · back at ${clock(recovery.recoveredAt)}`)
        add('Affected', affectedText(recovery))
      }
      break
    case 'trash_updated':
    case 'trash_rejected':
      out.push(...trashFields(data))
      use('from', 'to', 'commit', 'cause', 'compare_url', 'changes', 'unused', 'previous_unknown', 'commits', 'reasons_unavailable', 'library')
      break
    default:
      add('Message', m)
  }
  if (e.kind === 'grab') use('by')
  for (const [k, v] of Object.entries(data)) if (!used.has(k) && v !== null && v !== undefined && v !== '') add(label(k), valueText(v), typeof v === 'string' && /[/\\.]/.test(v))
  // Who or what started it and why, from the entry's trigger and reason; a reason a kind's own lines already show is not said twice.
  add('Started by', triggerText(e.trigger) ?? undefined)
  const reason = reasonText(e)
  if (reason && !out.some((f) => f.key === 'Reason' && f.value === reason)) add('Reason', reason)
  out.push({ key: 'When', value: fullTime(e.at) })
  return out
}

type TrashChange = { op: string; text: string; commits?: string[] }
type TrashCommit = { sha: string; message: string }

/**
 * What a TRaSH update or a rejected one changed: Added, Removed and Changed, each change with the TRaSH commits behind it,
 * then what it did to the Library and the comparison on GitHub.
 */
function trashFields(data: Record<string, unknown>): Field[] {
  const out: Field[] = []
  const add = (key: string, value: string | undefined, more: Partial<Field> = {}) => {
    if (value) out.push({ key, value, ...more })
  }
  const sha = (s: string) => s.slice(0, 7)
  const commits = Array.isArray(data.commits) ? (data.commits as TrashCommit[]) : []
  const why = (c: TrashChange) =>
    (c.commits ?? [])
      .map((s) => {
        const k = commits.find((x) => x.sha === s)
        return k ? `${k.message} (${sha(s)})` : sha(s)
      })
      .join('; ')
  add('Commit', str(data.commit) && sha(data.commit as string), { mono: true })
  add('Cause', str(data.cause), { mono: true })
  if (str(data.from) && str(data.to)) add('Update', `${sha(data.from as string)} → ${sha(data.to as string)}`, { mono: true })
  const changes = Array.isArray(data.changes) ? (data.changes as TrashChange[]) : []
  for (const [op, key] of [
    ['added', 'Added'],
    ['removed', 'Removed'],
    ['changed', 'Changed'],
  ]) {
    const lines = changes.filter((c) => c.op === op).map((c) => [c.text, why(c)].filter(Boolean).join(' · '))
    add(key, lines.join('\n'))
  }
  if (typeof data.unused === 'number' && data.unused > 0) add('Not used', `and ${plural(data.unused, 'change')} to profiles you don't use`)
  if (data.previous_unknown) add('What changed', "The set the files were scored under wasn't kept, so what changed isn't known")
  if (data.reasons_unavailable) add('Why', "TRaSH's reasons couldn't be fetched")
  else if (commits.length > 0) add('TRaSH commits', commits.map((k) => `${sha(k.sha)} ${k.message}`).join('\n'))
  const lib = data.library as { up: number; down: number; wanted: string[]; cutoff: number } | undefined
  if (lib) {
    const parts = [`${plural(lib.up + lib.down, 'file')} re-scored${lib.up + lib.down > 0 ? ` (${lib.up} up, ${lib.down} down)` : ''}`]
    if (lib.cutoff > 0) parts.push(`${lib.cutoff} reached their Cutoff`)
    add('Library', parts.join(' · '))
    add('Now Wanted', lib.wanted.join('\n'))
  }
  add('Compare', str(data.compare_url) && 'See the changes on GitHub', { href: str(data.compare_url) })
  return out
}

/** Which Grabs an outage held up: "2 Grabs waited · none lost". Undefined when the event does not say. */
function affectedText(r: Recovery): string | undefined {
  if (r.waited === undefined) return undefined
  const lost = r.lost === undefined ? '' : r.lost > 0 ? ` · ${r.lost} lost` : ' · none lost'
  return r.waited === 0 ? `No Grabs waited${lost}` : `${plural(r.waited, 'Grab')} waited${lost}`
}

/**
 * What makes two errors the same error: their kind and what went wrong. A Needs attention row is the same when its check key
 * is; a failed or rejected Grab when its reason is; a Blocklist entry when its reason is. Null for an event this cannot tell.
 */
export function errorSignature(e: LogEvent): string | null {
  const data = (e.data ?? {}) as Record<string, unknown>
  const m = e.message
  switch (e.kind) {
    case 'health_raised':
      return str(data.key) ?? str(data.kind) ?? m
    case 'grab_failed':
      return /^Download failed \((.+?)\): /.exec(m)?.[1] ?? (/^Discarded/.test(m) ? 'discarded' : m)
    case 'import_rejected':
      return /^Import of .+? rejected: (.+)$/.exec(m)?.[1] ?? m
    case 'import_stalled':
      return /^Import of .+? stalled: (.+)$/.exec(m)?.[1] ?? m
    case 'blocklist':
      return /^Blocklisted .+?: (.+)$/.exec(m)?.[1] ?? m
    default:
      return null
  }
}
