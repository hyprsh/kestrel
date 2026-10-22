// The Requests screen's qualifiers (status:, requester:, source:) and how a parsed filter becomes
// the GET /requests parameters. The grammar is the design system's.
import type { RequestFilter } from '../api/requests'
import { valuesOf, type Qualifier, type Query } from '@hyprsh/design'

const states = ['open', 'completed', 'rejected'] as const

/** The qualifiers, offering the requesters and sources of the Requests already loaded. */
export function requestQualifiers(requesters: readonly string[], sources: readonly string[]): Qualifier[] {
  return [
    { name: 'status', help: 'open (on its way), completed or rejected', values: states },
    { name: 'requester', help: 'Who asked, by name; quote names with spaces', suggestions: requesters },
    { name: 'source', help: 'Where the Request came from, such as silo', suggestions: sources },
  ]
}

/** Values of one qualifier are OR-ed; the same qualifier typed twice must match both. */
export function requestFilter(q: Query): RequestFilter {
  return { status: valuesOf(q, 'status') as RequestFilter['status'], requester: valuesOf(q, 'requester'), source: valuesOf(q, 'source') }
}
