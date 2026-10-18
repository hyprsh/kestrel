// Needs attention: the rows the server raised, with the actions it built. Nothing
// here knows a kind of row; it draws message, severity and buttons.
import { useState } from 'react'
import { useAttention, useRunAction, type Attention, type AttentionAction, type AttentionRow } from '../api/attention'
import { Button, ErrorText } from '../forms'
import { slotLabel } from '../library/bits'
import { Badge } from '../ui'

export function NeedsAttention({ onOpen }: { onOpen: (path: string) => void }) {
  const attention = useAttention()
  const rows = attention.data?.rows ?? []
  const longMissing = attention.data?.long_missing
  return (
    <section aria-labelledby="needs-attention" className="mx-auto mb-8 max-w-3xl">
      <h2 id="needs-attention" className="mb-3 text-sm font-medium">
        Needs attention
      </h2>
      {attention.data && rows.length === 0 ? (
        <p className="text-gray-900">Nothing needs attention.</p>
      ) : (
        rows.length > 0 && (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {rows.map((r) => (
              <Row key={r.id} row={r} onOpen={onOpen} />
            ))}
          </ul>
        )
      )}
      {longMissing && longMissing.count > 0 && <LongMissingRow group={longMissing} onOpen={onOpen} />}
    </section>
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
      <div className="flex items-center gap-2">
        <Badge tone="gray">Long missing</Badge>
        <span className="min-w-0 flex-1">
          {group.count} {group.count === 1 ? 'Version' : 'Versions'} long missing
        </span>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
        <Button variant="secondary" onClick={() => onOpen('/library/long-missing')}>
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
              <div className="text-[12px] text-gray-900">
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

function Row({ row, onOpen }: { row: AttentionRow; onOpen: (path: string) => void }) {
  const run = useRunAction()
  const [result, setResult] = useState<string | null>(null)

  const act = (a: AttentionAction) => {
    if (a.confirm && !window.confirm(a.confirm)) return
    if (a.method === 'GET') return onOpen(a.path) // GET opens an SPA path
    setResult(null)
    run.mutate(a, { onSuccess: (r) => setResult(r.message) })
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <Badge tone={row.severity === 'blocking' ? 'red' : 'amber'}>{row.severity === 'blocking' ? 'Blocking' : 'Warning'}</Badge>
        <span className="min-w-0 flex-1">{row.message}</span>
      </div>
      {row.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {row.actions.map((a) => (
            <Button key={a.key} variant="secondary" disabled={run.isPending} onClick={() => act(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {run.isError && <ErrorText>{run.error.message}</ErrorText>}
      {result && <p className="text-[12px] text-gray-900">{result}</p>}
    </li>
  )
}
