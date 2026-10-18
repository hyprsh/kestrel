// Needs attention: the rows the server raised, with the actions it built. Nothing
// here knows a kind of row; it draws message, severity and buttons.
import { useState } from 'react'
import { useAttention, useRunAction, type AttentionAction, type AttentionRow } from '../api/attention'
import { Button, ErrorText } from '../forms'
import { Badge } from '../ui'

export function NeedsAttention({ onOpen }: { onOpen: (path: string) => void }) {
  const attention = useAttention()
  const rows = attention.data?.rows ?? []
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
    </section>
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
