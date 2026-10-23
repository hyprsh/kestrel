// Needs attention: the rows the server raised, with the actions it built. Nothing
// here knows a kind of row; it draws message, severity and buttons.
import { Badge, Button, Note, useToasts } from '@hyprsh/design'
import { useState } from 'react'
import { useAttention, useRunAction, type ActionResult, type Attention, type AttentionAction, type AttentionRow } from '../api/attention'
import { slotLabel } from '../library/bits'
import { placePath } from '../place'
import { NavRow } from '../ui'
import { OriginalsRow } from './OriginalsRow'
import type { OverviewNav } from './nav'
import { EmptyLine, firstFive, Section, ViewAllHere } from './Section'

/**
 * The rows on show: five, or all of them once expanded. Blocking rows always show, so a
 * Blocking row past the fifth is never hidden behind "View all".
 */
export const shownRows = (rows: AttentionRow[], all: boolean) => (all ? rows : firstFive(rows, (r) => r.severity === 'blocking'))

/** `all` (kept by the Overview, whose j/k list must match) is whether the section is expanded. */
export function NeedsAttention({
  onOpen,
  onOpenTitle,
  nav,
  all,
  onAll,
}: {
  onOpen: (path: string) => void
  onOpenTitle: (id: number) => void
  nav: OverviewNav
  all: boolean
  onAll: (all: boolean) => void
}) {
  const attention = useAttention()
  const rows = attention.data?.rows ?? []
  const shown = shownRows(rows, all)
  const longMissing = attention.data?.long_missing
  const originals = attention.data?.originals
  // Long Missing only waits, so it leaves the section saying nothing needs attention; offers ask for a choice.
  const nothing = rows.length === 0 && !(originals && originals.count > 0)
  return (
    <Section id="needs-attention" title="Needs attention" count={rows.length}>
      {attention.data && nothing ? (
        <EmptyLine title="Nothing needs attention." />
      ) : (
        rows.length > 0 && (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {shown.map((r, i) => (
              <Row
                key={r.id}
                row={r}
                onOpen={onOpen}
                nav={nav}
                index={nav.base + i}
              />
            ))}
          </ul>
        )
      )}
      {(all || shown.length < rows.length) && <ViewAllHere count={rows.length} open={all} onToggle={() => onAll(!all)} />}
      {longMissing && longMissing.count > 0 && <LongMissingRow group={longMissing} onOpen={onOpen} />}
      {originals && originals.count > 0 && <OriginalsRow group={originals} onOpenTitle={onOpenTitle} />}
    </Section>
  )
}

const dateOf = (iso: string) => iso.slice(0, 10)

/**
 * Versions Wanted for over 90 days, as one row that comes last and is not in the
 * rail badge. It expands to the five most recently Wanted and links to the
 * Library on its Long Missing filter.
 */
function LongMissingRow({ group, onOpen }: { group: Attention['long_missing']; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-long-missing className="mt-3 rounded-lg border border-gray-alpha-400 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="gray-subtle" size="sm">Long missing</Badge>
        <span className="min-w-0 flex-1 max-sm:basis-full">
          {group.count} {group.count === 1 ? 'Version' : 'Versions'} long missing
        </span>
        <Button variant="secondary" size="small" aria-expanded={open} onClick={() => setOpen(!open)} className="max-sm:flex-1">
          {open ? 'Hide' : 'Show'}
        </Button>
        <Button variant="secondary" size="small" className="max-sm:flex-1" onClick={() => onOpen(placePath('library', 'is:long_missing sort:wanted_since'))}>
          Open in Library
        </Button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-gray-alpha-400">
          {group.items.map((i) => (
            <li key={i.version_id} className="py-2">
              <div>
                {i.title} · {slotLabel[i.slot]} · {i.profile}
              </div>
              <div className="label-12 text-gray-900">
                Wanted since {dateOf(i.wanted_since)}
                {i.last_failure ? `, last failure: ${i.last_failure.replaceAll('_', ' ')}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ row, onOpen, nav, index }: { row: AttentionRow; onOpen: (path: string) => void; nav: OverviewNav; index: number }) {
  const run = useRunAction()
  const toasts = useToasts()
  // Local, so a row that a passing action clears takes its result with it; a pass is a toast instead.
  const [result, setResult] = useState<(ActionResult & { label: string }) | null>(null)

  const act = (a: AttentionAction) => {
    if (a.confirm && !window.confirm(a.confirm)) return
    if (a.method === 'GET') return onOpen(a.path) // GET opens an SPA path
    setResult(null)
    // mutateAsync, not mutate's onSuccess: a passing Test clears this row, and a per-call callback dies with it.
    // A failure shows on the row through run.error, so the rejection is not handled here.
    run.mutateAsync(a).then((r) => {
      if (r.ok === true) toasts.success(`${a.label} passed${r.message ? `: ${r.message}` : ''}`)
      else setResult({ ...r, label: a.label })
    }, () => {})
  }

  return (
    <NavRow scope="ov" index={index} sel={nav.sel} onSelect={() => nav.select(index)} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <Badge variant={row.severity === 'blocking' ? 'red-subtle' : 'amber-subtle'} size="sm">{row.severity === 'blocking' ? 'Blocking' : 'Warning'}</Badge>
        <span className="min-w-0 flex-1">{row.message}</span>
      </div>
      {row.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          {row.actions.map((a) => (
            <Button key={a.key} variant="secondary" size="small" disabled={run.isPending} onClick={() => act(a)} className="max-sm:w-full">
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {run.isError && <Note variant="error">{run.error.message}</Note>}
      {result && <Result {...result} />}
    </NavRow>
  )
}

/** A failure is an error Note; an answer without a verdict (`ok` null) is just its message. A pass is a toast, so it never gets here. */
function Result({ label, ok, message }: ActionResult & { label: string }) {
  if (ok === null) return message ? <p className="label-12 text-gray-900">{message}</p> : null
  return (
    <Note variant="error" size="small">
      {label} failed{message ? `: ${message}` : ''}
    </Note>
  )
}
