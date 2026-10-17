import { ArrowLeft, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/queries'
import { useGrab, useReleases, type Release } from '../api/grabs'
import { Button } from '../forms'
import { useKey, useListNav } from '../keys'
import { Badge, cx, Kbd } from '../ui'

function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

function age(iso: string): string {
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000)
  return hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`
}

/** What the Grab button does for a Release: refused for blocklisted and other-Slot ones, "Grab anyway" for the rest that are rejected. */
function grabState(r: Release): { label: string; disabled: boolean; override: boolean; reason?: string } {
  const reason = r.rejections.map((x) => x.message).join(' · ') || undefined
  if (r.fits === 'other_slot' || r.rejections.some((x) => !x.overridable)) return { label: 'Grab', disabled: true, override: false, reason }
  if (r.rejections.length > 0) return { label: 'Grab anyway', disabled: false, override: true, reason }
  return { label: 'Grab', disabled: false, override: false }
}

const rejectionBlocked = (r: Release) => r.fits === 'other_slot' || r.rejections.some((x) => !x.overridable)

/**
 * Manual search for one Version: every Release the indexers offered, scored
 * against the Version's Profile, in a keyboard table. j/k select, Enter grabs,
 * Escape goes back.
 */
export function ManualSearch({
  titleName,
  slotLabel,
  profileName,
  versionId,
  onBack,
}: {
  titleName: string
  slotLabel: string
  profileName: string
  versionId: number
  onBack: () => void
}) {
  const search = useReleases(versionId)
  const grabbing = useGrab()
  const [hideRejected, setHideRejected] = useState(false)
  const [sel, setSel] = useState(0)
  const [sent, setSent] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const all = search.data?.items ?? []
  const rows = hideRejected ? all.filter((r) => r.rejections.length === 0) : all
  const index = Math.min(sel, Math.max(rows.length - 1, 0))
  const current = rows[index] as Release | undefined
  const g = current && grabState(current)

  const grab = () => {
    if (!current || !g || g.disabled || grabbing.isPending) return
    setSent(null)
    setProblem(null)
    grabbing.mutate(
      { version_id: versionId, release_id: current.release_id, override: g.override },
      {
        onSuccess: () => setSent(current.name),
        onError: (e) => {
          setProblem(e.message)
          // The cache forgot the Release (6 h) or the indexer lost it: the list is stale, so search again.
          if (e instanceof ApiError && e.code === 'release_expired') void search.refetch()
        },
      },
    )
  }

  useListNav('ms', rows.length, index, setSel, grab)
  useKey('Escape', onBack)

  const errors = search.data?.indexer_errors ?? []
  return (
    <section ref={ref} tabIndex={-1} aria-label="Manual search" className="flex min-w-0 flex-1 flex-col outline-none">
      <div className="flex items-center gap-3 border-b border-gray-alpha-400 px-4 py-2.5">
        <Button variant="secondary" className="h-7 px-2" onClick={onBack}>
          <ArrowLeft className="mr-1 size-3.5" />
          {titleName}
        </Button>
        <span className="font-semibold tracking-tight">Manual search</span>
        <span className="rounded border border-gray-alpha-400 px-1 font-mono text-[11px]">{slotLabel}</span>
        <span className="text-gray-900">
          Profile {profileName} · {rows.length} Releases · best first
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-gray-900">
          <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} />
          Hide rejected
        </label>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="border-b border-gray-alpha-400 bg-amber-200 px-4 py-1.5 text-[12px] text-amber-900">
          {errors.map((e) => (
            <div key={`${e.indexer_id}-${e.indexer}`}>
              {e.indexer}: {e.message}
              {e.retry_after ? ` (retry in ${e.retry_after} s)` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {search.isPending ? (
          <div className="p-4 text-gray-900">Searching every indexer…</div>
        ) : search.isError ? (
          <p role="alert" className="p-4 text-[12px] text-red-900">
            {search.error.message}
          </p>
        ) : (
          <table aria-label="Releases" className="w-full table-fixed border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-background-100">
              <tr className="border-b border-gray-alpha-400 text-[11px] text-gray-900 [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="w-16 pl-4 text-right">Score</th>
                <th>Release</th>
                <th className="w-28">Quality</th>
                <th className="w-28">Languages</th>
                <th className="w-52">Custom formats</th>
                <th className="w-20 text-right">Size</th>
                <th className="w-14 text-right">Age</th>
                <th className="w-28 pr-4">Indexer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => {
                const rejected = x.rejections.length > 0
                const dim = rejected && 'opacity-50'
                return (
                  <tr
                    key={x.release_id}
                    aria-selected={i === index}
                    data-nav={`ms-${i}`}
                    onClick={() => setSel(i)}
                    onDoubleClick={grab}
                    className={cx(
                      'cursor-pointer border-b border-gray-alpha-400 align-top [&>td]:px-2 [&>td]:py-1.5',
                      i === index ? '[&>td]:bg-gray-alpha-200' : 'hover:[&>td]:bg-gray-alpha-100',
                    )}
                  >
                    <td className={cx('pl-4 text-right font-mono tabular-nums', dim)}>{x.score.toLocaleString('en-US')}</td>
                    <td>
                      <div className={cx('flex items-center gap-1.5', dim)}>
                        <span className="truncate font-mono text-[12px]" title={x.name}>
                          {x.name}
                        </span>
                        {x.rejections.some((r) => r.code === 'blocklisted') && <Badge tone="red">Blocklisted</Badge>}
                        {x.fits === 'other_slot' && <Badge>Other Slot</Badge>}
                      </div>
                      {rejected && (
                        <div className={cx('mt-0.5 text-[11px]', rejectionBlocked(x) ? 'text-red-900' : 'text-amber-900')}>
                          {x.rejections.map((r) => r.message).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className={cx('whitespace-nowrap', dim)}>{x.quality}</td>
                    <td className={cx('whitespace-nowrap', dim)}>{x.languages.join(', ')}</td>
                    <td className={cx(dim)}>
                      <div className="flex flex-wrap gap-1">
                        {x.custom_formats.map((f) => (
                          <span key={f.name} title={`${f.points} points`} className="rounded bg-gray-alpha-200 px-1 text-[11px] whitespace-nowrap">
                            {f.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={cx('text-right font-mono whitespace-nowrap tabular-nums', dim)}>{size(x.size)}</td>
                    <td className={cx('text-right font-mono whitespace-nowrap tabular-nums', dim)}>{age(x.published_at)}</td>
                    <td className={cx('pr-4 whitespace-nowrap', dim)}>{x.indexer}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {search.isSuccess && rows.length === 0 && <div className="p-4 text-gray-900">No Releases found.</div>}
      </div>

      <div className="flex items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">
        <div className="min-w-0 flex-1" aria-live="polite">
          {sent ? (
            <div className="truncate text-[12px] text-green-900">Sent to the download client: {sent}</div>
          ) : problem ? (
            <div role="alert" className="truncate text-[12px] text-red-900">
              {problem}
            </div>
          ) : current && g ? (
            <>
              <div className="truncate font-mono text-[12px]">
                {current.name} <span className="text-gray-900">· {current.score.toLocaleString('en-US')} · {size(current.size)} · {current.indexer}</span>
              </div>
              <div className={cx('truncate text-[12px]', g.disabled ? 'text-red-900' : g.reason ? 'text-amber-900' : 'text-gray-900')}>
                {g.reason ?? `Fits the ${slotLabel} Version under Profile ${profileName}`}
              </div>
            </>
          ) : null}
        </div>
        <span className="flex items-center gap-1 text-[11px] text-gray-900">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> select · <Kbd>↵</Kbd> grab · <Kbd>esc</Kbd> back
        </span>
        {g && (
          <Button variant={g.override ? 'secondary' : 'primary'} disabled={g.disabled || grabbing.isPending} onClick={grab} title={g.reason}>
            <Download className="mr-1 size-3.5" />
            {g.label}
          </Button>
        )}
      </div>
    </section>
  )
}
