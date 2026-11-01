// The Health verdict: what is wrong, in one plain sentence per problem, and where it gets fixed. The problems are the
// health rows of Needs attention (the same ones the rail's Health button counts) plus any failing check that has no row
// yet (a download client or an indexer inside its grace period).
import { useAttention, useStatus, type AttentionAction, type AttentionRow, type SystemStatus } from '../api/attention'
import { failingSince, healthOf } from './tiles'

export type Problem = {
  key: string
  severity: 'blocking' | 'warning'
  /** "altHUB rejected Kestrel's API key, since 12:12. Searches skip it until it is fixed." */
  sentence: string
  /** Where it gets fixed: the row's own action, or a Settings page. */
  action?: AttentionAction
}

/** What a kind of problem stops, in a sentence of its own. A kind this SPA does not know says nothing more. */
const affects: Record<string, string> = {
  download_client_unreachable: 'Nothing is downloaded or imported until it is fixed.',
  indexer_failing: 'Searches skip it until it is fixed.',
  no_indexer: 'Nothing can be found until an indexer works.',
  root_folder_unavailable: 'Imports into it wait until it is fixed.',
  metadata_provider_failing: 'Titles cannot be added or refreshed from it until it is fixed.',
  media_server_unreachable: 'Its library is not told about new files until it is fixed.',
  low_disk_space: 'Downloads and Imports may fail when it runs out.',
  refresh_failed: 'Its library may not show new files yet.',
  untrusted_proxy_header: 'Sign-in through the proxy is not trusted from that address.',
}

/** Where a row is fixed: its Open action (a GET to a Settings page), else its first action that is not a dismissal. */
function fixOf(row: AttentionRow): AttentionAction | undefined {
  return row.actions.find((a) => a.method === 'GET' && a.path.startsWith('/settings')) ?? row.actions.find((a) => a.key !== 'dismiss' && a.key !== 'log') ?? row.actions[0]
}

const openSettings = (path: string): AttentionAction => ({ key: 'open', label: 'Open in Settings', method: 'GET', path, body: null, confirm: null })

/** The button's words: "Fix in Settings" for a Settings page, else the action's own label. */
export const fixLabel = (a: AttentionAction) => (a.method === 'GET' && a.path.startsWith('/settings') ? 'Fix in Settings' : a.label)

/** The problems now: blocking ones first, each in order of appearance. */
export function problemsOf(rows: AttentionRow[], status: SystemStatus | undefined, now = Date.now()): Problem[] {
  const out: Problem[] = rows
    .filter((r) => r.id.startsWith('health-'))
    .map((r) => ({
      key: r.id,
      severity: r.severity,
      sentence: [`${failingSince(r.message, r.since, now)}.`, affects[r.kind]].filter(Boolean).join(' '),
      action: fixOf(r),
    }))
  if (status) {
    const covered = new Set(rows.map((r) => r.subject.plugin_instance_id).filter((id) => id != null))
    for (const t of healthOf(status, now).groups.flatMap((g) => g.tiles)) {
      const client = t.key === 'client'
      // Only these two fail before they have a row; a metadata provider or a media server fails by its row.
      if (t.tone !== 'failing' || !(client || t.key.startsWith('indexer-')) || (t.instanceId != null && covered.has(t.instanceId))) continue
      out.push({
        key: t.key,
        severity: 'blocking',
        sentence: `${t.detail.includes(t.name) ? t.detail : `${client ? 'The download client' : 'The indexer'} ${t.name}: ${t.detail}`}. ${affects[client ? 'download_client_unreachable' : 'indexer_failing']}`,
        action: openSettings(client ? '/settings/download-client' : '/settings/indexers'),
      })
    }
  }
  return out.sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'))
}

/** "1 problem needs you", "2 problems need you", "1 warning to look at"; with both, the problems lead. */
export function headline(problems: Problem[]): string {
  const bad = problems.filter((p) => p.severity === 'blocking').length
  const warn = problems.length - bad
  const w = `${warn} ${warn === 1 ? 'warning' : 'warnings'}`
  if (bad === 0) return `${w} to look at`
  return `${bad} ${bad === 1 ? 'problem needs' : 'problems need'} you${warn > 0 ? ` · ${w}` : ''}`
}

/** The verdict now, from the live Needs attention rows and the status. `ready` is false until the rows are known. */
export function useVerdict(): { problems: Problem[]; ready: boolean } {
  const attention = useAttention()
  const status = useStatus()
  return { problems: problemsOf(attention.data?.rows ?? [], status.data), ready: attention.data !== undefined }
}
