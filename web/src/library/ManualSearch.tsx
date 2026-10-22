import { Badge, Button, Checkbox, EmptyState, KeyboardInput, Note, Spinner, Table } from '@hyprsh/design'
import { ArrowLeft, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/queries'
import { useGrab, useReleases, type Release } from '../api/grabs'
import type { EpisodeScope } from '../api/queries'
import { useKey, useListNav } from '../keys'
import { cx } from '../ui'

function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

function age(iso: string): string {
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000)
  return hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`
}

/**
 * What the Grab button does for a Release: refused for an other-Slot one or one with a rejection that is not
 * overridable (blocklisted, a season TheTVDB does not list), "Grab anyway" for the rest that are rejected.
 */
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
 * Escape goes back. A Series search can be narrowed to a season or episodes
 * (`scope`), named in the header by `scope.label`.
 */
export function ManualSearch({
  titleName,
  slotLabel,
  profileName,
  versionId,
  scope,
  onBack,
}: {
  titleName: string
  slotLabel: string
  profileName: string
  versionId: number
  scope?: { body: EpisodeScope; label: string }
  onBack: () => void
}) {
  const search = useReleases(versionId, scope?.body)
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
        <Button variant="secondary" size="small" prefix={<ArrowLeft className="size-4" />} onClick={onBack}>
          {titleName}
        </Button>
        <h2 className="heading-16">Manual search</h2>
        <Badge variant="gray-subtle" size="sm">
          {slotLabel}
        </Badge>
        {scope && (
          <Badge variant="gray-subtle" size="sm">
            {scope.label}
          </Badge>
        )}
        <span className="copy-13 text-gray-900">
          Profile {profileName} · {rows.length} Releases · best first
        </span>
        <span className="ml-auto">
          <Checkbox checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)}>
            Hide rejected
          </Checkbox>
        </span>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="border-b border-gray-alpha-400 px-4 py-2">
          <Note variant="warning" size="small">
            {errors.map((e) => (
              <div key={`${e.indexer_id}-${e.indexer}`}>
                {e.indexer}: {e.message}
                {e.retry_after ? ` (retry in ${e.retry_after} s)` : ''}
              </div>
            ))}
          </Note>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {search.isPending ? (
          <div className="copy-13 flex items-center gap-2 p-4 text-gray-900">
            <Spinner size="sm" />
            Searching every indexer…
          </div>
        ) : search.isError ? (
          <div className="p-4">
            <Note variant="error" size="small">
              {search.error.message}
            </Note>
          </div>
        ) : (
          <Table.Root>
            <Table aria-label="Releases" className="table-fixed" stickyHeader>
              <Table.Colgroup>
                <Table.Col className="w-20" />
                <Table.Col />
                <Table.Col className="w-28" />
                <Table.Col className="w-24" />
                <Table.Col className="w-44" />
                <Table.Col className="w-20" />
                <Table.Col className="w-16" />
                <Table.Col className="w-28" />
              </Table.Colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head align="right">Score</Table.Head>
                  <Table.Head>Release</Table.Head>
                  <Table.Head>Quality</Table.Head>
                  <Table.Head>Languages</Table.Head>
                  <Table.Head>Custom formats</Table.Head>
                  <Table.Head align="right">Size</Table.Head>
                  <Table.Head align="right">Age</Table.Head>
                  <Table.Head>Indexer</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body interactive bordered>
                {rows.map((x, i) => {
                  const rejected = x.rejections.length > 0
                  const dim = rejected && 'opacity-50'
                  return (
                    <Table.Row
                      key={x.release_id}
                      selected={i === index}
                      data-nav={`ms-${i}`}
                      onClick={() => setSel(i)}
                      onDoubleClick={grab}
                      className="cursor-pointer align-top"
                    >
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>{x.score.toLocaleString('en-US')}</Table.Cell>
                      <Table.Cell wrap>
                        <div className={cx('flex items-center gap-1.5', dim)}>
                          <span className="label-12-mono truncate" title={x.name}>
                            {x.name}
                          </span>
                          {x.rejections.some((r) => r.code === 'blocklisted') && (
                            <Badge variant="red-subtle" size="sm">
                              Blocklisted
                            </Badge>
                          )}
                          {x.fits === 'other_slot' && (
                            <Badge variant="gray-subtle" size="sm">
                              Other Slot
                            </Badge>
                          )}
                          {scopeLabel(x) && (
                            <Badge variant="gray-subtle" size="sm">
                              {scopeLabel(x)}
                            </Badge>
                          )}
                        </div>
                        {rejected && (
                          <div className={cx('label-12 mt-0.5', rejectionBlocked(x) ? 'text-red-900' : 'text-amber-900')}>
                            {x.rejections.map((r) => r.message).join(' · ')}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className={dim || undefined}>{x.quality}</Table.Cell>
                      <Table.Cell className={dim || undefined}>{x.languages.join(', ')}</Table.Cell>
                      <Table.Cell wrap className={dim || undefined}>
                        <div className="flex flex-wrap gap-1">
                          {x.custom_formats.map((f) => (
                            <Badge key={f.name} variant="gray-subtle" size="sm" title={`${f.points} points`}>
                              {f.name}
                            </Badge>
                          ))}
                        </div>
                      </Table.Cell>
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>{size(x.size)}</Table.Cell>
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>{age(x.published_at)}</Table.Cell>
                      <Table.Cell className={dim || undefined}>{x.indexer}</Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </Table.Root>
        )}
        {search.isSuccess && rows.length === 0 && <EmptyState title="No Releases found." />}
      </div>

      <div className="flex items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">
        <div className="min-w-0 flex-1" aria-live="polite">
          {sent ? (
            <div className="label-12 truncate text-green-900">Sent to the download client: {sent}</div>
          ) : problem ? (
            <div role="alert" className="label-12 truncate text-red-900">
              {problem}
            </div>
          ) : current && g ? (
            <>
              <div className="label-12-mono truncate">
                {current.name} <span className="text-gray-900">· {current.score.toLocaleString('en-US')} · {size(current.size)} · {current.indexer}</span>
              </div>
              <div className={cx('label-12 truncate', g.disabled ? 'text-red-900' : g.reason ? 'text-amber-900' : 'text-gray-900')}>
                {g.reason ?? `Fits the ${slotLabel} Version under Profile ${profileName}`}
              </div>
            </>
          ) : null}
        </div>
        <span className="label-12 flex items-center gap-1 text-gray-900">
          <KeyboardInput small>j</KeyboardInput>
          <KeyboardInput small>k</KeyboardInput> select · <KeyboardInput small>↵</KeyboardInput> grab · <KeyboardInput small>esc</KeyboardInput> back
        </span>
        {g && (
          <Button variant={g.override ? 'secondary' : 'primary'} size="small" prefix={<Download className="size-4" />} disabled={g.disabled || grabbing.isPending} onClick={grab} title={g.reason}>
            {g.label}
          </Button>
        )}
      </div>
    </section>
  )
}

/** What a Series Release holds: "Season 1 pack", or "S01E03" / "S01E03-E04" for episodes. */
function scopeLabel(x: Release): string | null {
  if (x.pack) return `Season ${x.season ?? ''} pack`.replace('  ', ' ')
  const eps = x.episodes ?? []
  if (x.season == null || eps.length === 0) return null
  const code = (n: number) => String(n).padStart(2, '0')
  const last = eps[eps.length - 1]
  return eps.length > 1 ? `S${code(x.season)}E${code(eps[0])}-E${code(last)}` : `S${code(x.season)}E${code(eps[0])}`
}
