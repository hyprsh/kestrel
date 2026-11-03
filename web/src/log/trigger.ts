// Who or what started an event, and why, in words: the trigger an event stores (kind, actor, via) and its reason.
// The set of trigger kinds grows on the server; one this file does not know reads as its raw kind, never hidden.
import type { LogEvent } from '../api/log'
import { reasonWords } from '../rejection'

/** The trigger kinds the Log can be filtered by (`by:person`), with how each reads as a menu option. A kind not listed still filters when typed. */
export const triggerKinds: Readonly<Record<string, string>> = {
  person: 'A person',
  api_key: 'The API key',
  sweep: 'The search sweep',
  rss: 'The RSS sweep',
  import: 'The Import loop',
  retry: 'A retry',
  request: 'A Request',
  rule: 'A rule',
  startup: 'Startup',
  job: 'A background job',
}

/** An operation id or a loop name as words: `updateSettings` -> "update settings". */
const words = (via: string) =>
  via
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()

/** Who or what started an event: "Navi · update settings", "The search sweep", "The watch ahead rule". Null for an entry from before triggers were recorded. */
export function triggerText(t: LogEvent['trigger'] | undefined): string | null {
  if (!t || !t.kind) return null
  const via = t.via ? words(t.via) : ''
  switch (t.kind) {
    case 'person':
      return [t.actor || 'A person', via].filter(Boolean).join(' · ')
    case 'api_key':
      return ['The API key', via].filter(Boolean).join(' · ')
    case 'request':
      return via ? `A Request from ${via}` : 'A Request'
    case 'rule':
      return via ? `The ${via} rule` : 'A rule'
    case 'job':
      return via ? `The ${via} job` : 'A background job'
    default:
      return triggerKinds[t.kind] ?? t.kind.replace(/_/g, ' ')
  }
}

/** The reason of an event, as the server wrote it ("due: 3 days after it became Wanted"), or null for an entry from before reasons were recorded. */
export const reasonText = (e: Pick<LogEvent, 'reason'>): string | null => (e.reason ? reasonWords(e.reason) : null)

/** "Navi · update settings · edited by hand" for a Title's history line; either part may be missing. */
export function causeText(e: Pick<LogEvent, 'trigger' | 'reason'>): string | null {
  const parts = [triggerText(e.trigger), reasonText(e)].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(' · ') : null
}
