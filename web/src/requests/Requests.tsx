// The Requests screen, behind the Overview's "View all": every Request from outside Kestrel,
// newest first, filtered by status:, requester: and source: (asked of the server) and free text
// on the Title and who asked (over the rows loaded). Off the rail; its place is "/requests".
import { useMemo, useState } from 'react'
import { useRequestList } from '../api/requests'
import { matchText } from '../fuzzy'
import { parse } from '../filter/query'
import { QueryField } from '../filter/QueryField'
import { Button, ErrorText } from '../forms'
import { useKey, useListNav } from '../keys'
import { requestFilter, requestQualifiers } from './filter'
import { RequestRow } from './RequestRow'

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Requests({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const [sel, setSel] = useState(0)
  // Requesters and sources are offered from what has been loaded: there is no list of them.
  const [seen, setSeen] = useState<{ requesters: string[]; sources: string[] }>({ requesters: [], sources: [] })
  const qualifiers = useMemo(() => requestQualifiers(seen.requesters, seen.sources), [seen])
  const parsed = useMemo(() => parse(query, qualifiers), [query, qualifiers])
  const list = useRequestList(useMemo(() => requestFilter(parsed), [parsed]))

  const loaded = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const requesters = [...new Set([...seen.requesters, ...loaded.map((r) => r.requester.name)])]
  const sources = [...new Set([...seen.sources, ...loaded.map((r) => r.source)])]
  if (requesters.length !== seen.requesters.length || sources.length !== seen.sources.length) setSeen({ requesters, sources })

  const shown = useMemo(() => loaded.filter((r) => matchText(parsed.text, [r.title ?? '', r.requester.name, r.source])), [loaded, parsed.text])
  const open = (i: number) => {
    const id = shown[i]?.title_id
    if (id != null) onOpenTitle(id)
  }
  useListNav('req', shown.length, Math.min(sel, Math.max(shown.length - 1, 0)), setSel, open)
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('requests-filter')?.focus()
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-alpha-400 px-4 py-2">
        <QueryField
          id="requests-filter"
          label="Filter Requests"
          placeholder="Filter, e.g. status:open requester:Anna …  /"
          value={query}
          onChange={onQuery}
          qualifiers={qualifiers}
        />
        {list.data && <span className="text-[12px] text-gray-900 tabular">{list.data.pages[0].total} in all</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {list.isError && <ErrorText>The Requests could not be loaded.</ErrorText>}
        {list.data && shown.length === 0 && <div className="p-6 text-center text-gray-900">No Request matches.</div>}
        <ul aria-label="Requests" className="divide-y divide-gray-alpha-200">
          {shown.map((r, i) => (
            <RequestRow key={r.id} request={r} nav={{ scope: 'req', index: i, sel, onSelect: () => setSel(i) }} onOpenTitle={onOpenTitle} />
          ))}
        </ul>
        {list.hasNextPage && (
          <div className="p-4 text-center">
            <Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Show older Requests
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
