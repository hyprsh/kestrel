// The Requests screen's qualifiers (status:, requester:, source:) and how a parsed filter becomes
// the GET /requests parameters. The grammar lives in filter/query.ts.
import type { RequestFilter } from '../api/requests'
import type { Qualifier, Query } from '../filter/query'

const states = ['open', 'completed', 'rejected'] as const

/** The qualifiers, offering the requesters and sources of the Requests already loaded. */
export function requestQualifiers(requesters: readonly string[], sources: readonly string[]): Qualifier[] {
  return [
    { name: 'status', help: 'open (on its way), completed or rejected', values: states },
    { name: 'requester', help: 'Who asked, by name; quote names with spaces', suggestions: requesters },
    { name: 'source', help: 'Where the Request came from, such as silo', suggestions: sources },
  ]
}

const intersect = (sets: string[][]): string[] | null => (sets.length === 0 ? null : sets.reduce((a, b) => a.filter((x) => b.includes(x))))

/** Values of one qualifier are OR-ed; the same qualifier typed twice must match both. */
export function requestFilter(q: Query): RequestFilter {
  const values = (name: string) => intersect(q.terms.filter((t) => t.name === name).map((t) => t.values))
  return { status: values('status') as RequestFilter['status'], requester: values('requester'), source: values('source') }
}
