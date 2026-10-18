// The Adoption review screen: scan the Movie Root folders, review the plan of matched,
// needs-choice and skipped entries, settle the doubtful ones and adopt what is ticked.
import { useState, type FormEvent } from 'react'
import {
  useAdoption,
  useAdoptionRows,
  useCommit,
  useDiscard,
  usePatchRow,
  useScan,
  type AdoptionFile,
  type AdoptionRow,
} from '../api/adoption'
import { ApiError, useLookup } from '../api/queries'
import { Button, ErrorText, TextInput } from '../forms'
import { slotLabel } from '../library/bits'
import { Badge } from '../ui'

type Filter = 'all' | 'matched' | 'needs_choice' | 'skipped' | 'duplicate' | 'replacement'

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'needs_choice', label: 'Needs choice' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'replacement', label: 'Replacements' },
]

const skipText: Record<string, string> = {
  invalid: 'No readable video file',
  no_video: 'No video file',
  no_enabled_profile: 'No enabled Profile for its Slot',
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

const adopts = (f: AdoptionFile) => f.ticked && !f.left
const willAdopt = (r: AdoptionRow) => r.status === 'matched' && r.ticked && r.files.some(adopts)

function inFilter(r: AdoptionRow, f: Filter) {
  switch (f) {
    case 'all':
      return true
    case 'duplicate':
      return r.files.some((x) => x.left === 'duplicate')
    case 'replacement':
      return r.files.some((x) => x.action === 'replace' && !x.left)
    default:
      return r.status === f
  }
}

export function Adoption() {
  const plan = useAdoption()
  const scan = useScan()
  const commit = useCommit()
  const discard = useDiscard()
  const [filter, setFilter] = useState<Filter>('all')
  const state = plan.data?.state
  const rows = useAdoptionRows(state === 'planned')

  if (!plan.data) return <div className="p-6 text-gray-900">{plan.isError ? 'Could not read the Adoption state.' : 'Loading…'}</div>
  const p = plan.data
  const failed = scan.error ?? commit.error ?? discard.error

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-[15px] font-semibold tracking-tight">Adopt existing library</h1>
        <p className="mt-1 text-gray-900">
          Kestrel scans your Movie Root folders and plans how to manage the files already there without downloading them again. Nothing changes until you
          adopt the plan.
        </p>
        {failed instanceof ApiError && <ErrorText>{failed.message}</ErrorText>}

        {(state === 'idle' || state === undefined) && (
          <div className="mt-4 flex flex-col gap-3">
            {p.error && <ErrorText>{p.error}</ErrorText>}
            {p.result && (
              <div role="status" className="rounded-md border border-gray-alpha-400 p-3">
                Adopted {p.result.adopted} {p.result.adopted === 1 ? 'Title' : 'Titles'}
                {p.result.failed > 0 && `, ${p.result.failed} could not be adopted (see the Log)`}.
              </div>
            )}
            <div>
              <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
                Scan for existing files
              </Button>
            </div>
          </div>
        )}

        {(state === 'scanning' || state === 'committing') && (
          <div role="status" className="mt-4 rounded-md border border-gray-alpha-400 p-3">
            {state === 'scanning' ? 'Scanning' : 'Adopting'}… {p.progress.done} of {p.progress.total}
          </div>
        )}

        {state === 'planned' && (
          <Plan
            rows={rows.data ?? []}
            filter={filter}
            onFilter={setFilter}
            summary={p.summary}
            onCommit={() => commit.mutate(p.revision)}
            onDiscard={() => discard.mutate()}
            busy={commit.isPending || discard.isPending}
          />
        )}
      </div>
    </div>
  )
}

function Plan({
  rows,
  filter,
  onFilter,
  summary,
  onCommit,
  onDiscard,
  busy,
}: {
  rows: AdoptionRow[]
  filter: Filter
  onFilter: (f: Filter) => void
  summary: { matched: number; needs_choice: number; skipped: number; duplicate: number; replacement: number }
  onCommit: () => void
  onDiscard: () => void
  busy: boolean
}) {
  const ticked = rows.filter(willAdopt).length
  const shown = rows.filter((r) => inFilter(r, filter))
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="status" className="text-gray-900">
          {summary.matched} matched, {summary.needs_choice} need a choice, {summary.skipped} skipped
        </div>
        <select
          aria-label="Show"
          value={filter}
          onChange={(e) => onFilter(e.target.value as Filter)}
          className="h-8 rounded-md border border-gray-alpha-400 bg-background-100 px-2"
        >
          {filters.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onDiscard} disabled={busy}>
            Discard plan
          </Button>
          <Button onClick={onCommit} disabled={busy || ticked === 0}>
            Adopt {ticked} {ticked === 1 ? 'Title' : 'Titles'}
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="mt-6 text-gray-900">{rows.length === 0 ? 'No files to adopt were found.' : 'No rows match this filter.'}</div>
      ) : (
        <ul className="mt-4 divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
          {shown.map((r) => (
            <li key={r.id} className="p-3">
              <Row row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ row }: { row: AdoptionRow }) {
  if (row.status === 'matched') return <MatchedRow row={row} />
  if (row.status === 'needs_choice') return <NeedsChoice row={row} />
  return (
    <div>
      <div className="font-medium">{baseName(row.entry)}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-gray-900">
        <Badge tone="gray">Skipped</Badge>
        {skipText[row.skip_reason ?? ''] ?? row.skip_reason}
      </div>
    </div>
  )
}

function MatchedRow({ row }: { row: AdoptionRow }) {
  const patch = usePatchRow()
  const m = row.match!
  const title = `${m.title}${m.year ? ` (${m.year})` : ''}`
  return (
    <div>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={row.ticked} onChange={(e) => patch.mutate({ id: row.id, patch: { ticked: e.target.checked } })} aria-label={`Adopt ${title}`} />
        {title}
        {m.title_id !== null && <Badge tone="blue">In library</Badge>}
        <span className="text-[12px] font-normal text-gray-900">{baseName(row.entry)}</span>
      </label>
      <ul className="mt-2 flex flex-col gap-1.5 pl-6">
        {row.files.map((f) => (
          <li key={f.path} className="flex flex-wrap items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={f.ticked && !f.left}
              disabled={!!f.left}
              onChange={(e) => patch.mutate({ id: row.id, patch: { files: [{ path: f.path, ticked: e.target.checked }] } })}
              aria-label={`Adopt ${baseName(f.path)}`}
            />
            <Badge tone="teal">{slotLabel[f.slot]}</Badge>
            <span className="font-mono text-gray-900">{baseName(f.path)}</span>
            <span aria-hidden>→</span>
            <span className="font-mono">{baseName(f.to)}</span>
            <span className="text-gray-900">
              {f.profile}, Score {f.score}
            </span>
            {f.subtitles.length > 0 && <span className="text-gray-900">+ {f.subtitles.length} subtitle{f.subtitles.length === 1 ? '' : 's'}</span>}
            {f.action === 'replace' && !f.left && (
              <Badge tone="amber">Would replace the current file (Score {f.score} vs {f.held_score ?? 0})</Badge>
            )}
            {f.left === 'duplicate' && <Badge tone="gray">Duplicate, left in place</Badge>}
            {f.left === 'path_occupied' && <Badge tone="gray">Name taken, left in place</Badge>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NeedsChoice({ row }: { row: AdoptionRow }) {
  const patch = usePatchRow()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const search = useLookup(query)
  const choose = (tmdb: number) => patch.mutate({ id: row.id, patch: { tmdb_id: tmdb } })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setQuery(q.trim())
  }
  const found = (search.data ?? []).filter((r) => r.kind === 'movie')
  return (
    <div>
      <div className="flex items-center gap-2 font-medium">
        {baseName(row.entry)} <Badge tone="amber">Needs choice</Badge>
      </div>
      {patch.error instanceof ApiError && <ErrorText>{patch.error.message}</ErrorText>}
      {row.candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.candidates.map((c) => (
            <Button key={c.tmdb_id} variant="secondary" onClick={() => choose(c.tmdb_id)} disabled={patch.isPending}>
              Use {c.title}
              {c.year ? ` (${c.year})` : ''}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="mt-2 flex max-w-md gap-2">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for the Movie" aria-label={`Search for ${baseName(row.entry)}`} />
        <Button variant="secondary" type="submit">
          Search
        </Button>
      </form>
      {found.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {found.map((r) => (
            <li key={r.tmdb_id}>
              <Button variant="secondary" onClick={() => choose(r.tmdb_id)} disabled={patch.isPending}>
                Pick {r.title}
                {r.year ? ` (${r.year})` : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
