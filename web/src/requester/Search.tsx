import { Badge, Button, EmptyState, Entity, Input, Note } from '@hyprsh/design'
import { Search as SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { useMakeRequest } from '../api/plex'
import { useLookup, type LookupResult } from '../api/queries'
import type { Request } from '../api/requests'
import { RowList, stackedRight, stackedRow } from '../layout/RowList'
import { LoadingLine, useDebounced } from '../loading'
import { Poster } from '../poster'
import { slotState } from '../requests/status'

const kindLabel: Record<LookupResult['kind'], string> = { movie: 'Movie', series: 'Series' }

/** Why a result can't be Requested, in words. The set grows, so an unknown reason gets a general line. */
const notAddable: Record<string, string> = { not_on_tvdb: 'Not on TheTVDB' }

/** The search field and its results: each says where the Title stands, or offers to Request it. */
export function Search({ requests }: { requests: Request[] }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 250)
  const lookup = useLookup(debounced)
  const make = useMakeRequest()
  const waiting = query.trim() !== '' && !lookup.isError && (query !== debounced || lookup.isFetching)
  const items = query.trim() === '' ? [] : (lookup.data?.items ?? [])
  const meant = query.trim() === '' ? null : lookup.data?.did_you_mean

  return (
    <section aria-labelledby="requester-search-title" className="flex flex-col gap-3">
      <h2 id="requester-search-title" className="heading-20">
        Find a Movie or Series
      </h2>
      <Input
        label="Title"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        prefix={<SearchIcon aria-hidden className="size-4" />}
        prefixStyling={false}
        placeholder="Search for a Title"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p aria-live="polite" className="sr-only">
        {query.trim() !== '' && !waiting && lookup.data ? `${items.length} ${items.length === 1 ? 'result' : 'results'}` : ''}
      </p>
      {waiting && items.length === 0 && <LoadingLine>Searching…</LoadingLine>}
      {lookup.isError && !waiting && (
        <Note variant="error" size="small">
          The search failed. Try again.
        </Note>
      )}
      {meant && !waiting && (
        <p className="copy-13 text-gray-900">
          Did you mean{' '}
          <Button variant="tertiary" size="tiny" onClick={() => setQuery(meant)}>
            {meant}
          </Button>
          ?
        </p>
      )}
      {query.trim() !== '' && !waiting && lookup.data && items.length === 0 && <EmptyState size="small" description="No Movie or Series found." />}
      {items.length > 0 && (
        <RowList aria-label="Search results">
          {items.map((r) => (
            <Result
              key={`${r.kind}-${r.tmdb_id}`}
              result={r}
              request={r.in_library != null ? requests.find((q) => q.title_id === r.in_library) : undefined}
              asking={make.isPending && make.variables.kind === r.kind && make.variables.tmdb_id === r.tmdb_id}
              onRequest={() => make.mutate({ kind: r.kind, tmdb_id: r.tmdb_id })}
            />
          ))}
        </RowList>
      )}
      {make.isError && (
        <Note variant="error" size="small">
          Could not make the Request. Try again.
        </Note>
      )}
    </section>
  )
}

function Result({ result: r, request, asking, onRequest }: { result: LookupResult; request?: Request; asking: boolean; onRequest: () => void }) {
  return (
    <Entity className={stackedRow} rightClassName={stackedRight} left={<Poster src={r.poster} size="md" />} right={<Status result={r} request={request} asking={asking} onRequest={onRequest} />}>
      <Entity.Content fill title={r.title} description={[r.year, kindLabel[r.kind]].filter(Boolean).join(' · ')} />
    </Entity>
  )
}

function Status({ result: r, request, asking, onRequest }: { result: LookupResult; request?: Request; asking: boolean; onRequest: () => void }) {
  if (request) {
    const state = request.slots[0] ? slotState(request.slots[0], []) : { text: 'Requested', tone: 'gray' as const }
    return (
      <Badge variant={state.tone} contrast="low" size="sm">
        {state.text}
      </Badge>
    )
  }
  if (r.in_library != null)
    return (
      <Badge variant="green" contrast="low" size="sm">
        In Library
      </Badge>
    )
  if (!r.addable) return <span className="label-12 text-gray-900">{(r.not_addable_reason && notAddable[r.not_addable_reason]) || 'Cannot be requested'}</span>
  return (
    <Button size="small" variant="primary" loading={asking} aria-label={`Request ${r.title}`} onClick={onRequest}>
      Request
    </Button>
  )
}
