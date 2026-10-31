import { Badge, Button, Checkbox, EmptyState, Entity, Error as ErrorMessage, KeyboardInput, Link, Note, Pill, Select, Table } from '@hyprsh/design'
import { ArrowLeft, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/queries'
import { useGrab, useReleases, type Release } from '../api/grabs'
import type { EpisodeScope } from '../api/queries'
import { useKey, useListNav } from '../keys'
import { placePath, useOpenPlace } from '../place'
import { useDisplay } from '../display/useDisplay'
import { FilterStrip } from '../layout/FilterStrip'
import { PaneFooter, PaneHeader } from '../layout/Pane'
import { usePhone } from '../responsive'
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

type SortKey = 'score' | 'release' | 'quality' | 'languages' | 'formats' | 'size' | 'age' | 'indexer'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }
type View = { sort: Sort; pinned: string | null }

const BEST_FIRST: Sort = { key: 'score', dir: 'desc' }

/** The columns, in order; `text` ones sort alphabetically, the rest numerically. */
const columns: { key: SortKey; label: string; align?: 'right'; text?: boolean }[] = [
  { key: 'score', label: 'Score', align: 'right' },
  { key: 'release', label: 'Release', text: true },
  { key: 'quality', label: 'Quality', text: true },
  { key: 'languages', label: 'Languages', text: true },
  { key: 'formats', label: 'Custom formats' },
  { key: 'size', label: 'Size', align: 'right' },
  { key: 'age', label: 'Age', align: 'right' },
  { key: 'indexer', label: 'Indexer', text: true },
]

/** What a skeleton row sizes its cells by: the Releases columns, the number ones right-aligned. */
const skeletonColumns = columns.map((c) => ({ key: c.key, header: c.label, numeric: c.align === 'right', mono: c.key === 'release', truncate: c.key === 'release' }))

const points = (r: Release) => r.custom_formats.reduce((sum, f) => sum + f.points, 0)

function valueOf(r: Release, key: SortKey): string | number {
  switch (key) {
    case 'score':
      return r.score
    case 'release':
      return r.name
    case 'quality':
      return r.quality
    case 'languages':
      return r.languages.join(', ')
    case 'formats':
      return points(r)
    case 'size':
      return r.size
    case 'age':
      return Date.now() - new Date(r.published_at).getTime()
    case 'indexer':
      return r.indexer
  }
}

/**
 * The order of the list: accepted Releases first, rejected ones below, each group sorted on its own; within a
 * group the Releases with the pinned Custom Format come first. Ties keep best-first order.
 */
function arrange(items: Release[], { sort, pinned }: View): Release[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const text = columns.find((c) => c.key === sort.key)?.text
  const cmp = (a: Release, b: Release) => {
    const rejected = Number(a.rejections.length > 0) - Number(b.rejections.length > 0)
    if (rejected !== 0) return rejected
    if (pinned) {
      const pin = Number(b.custom_formats.some((f) => f.name === pinned)) - Number(a.custom_formats.some((f) => f.name === pinned))
      if (pin !== 0) return pin
    }
    const x = valueOf(a, sort.key)
    const y = valueOf(b, sort.key)
    const by = text ? String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true }) : Number(x) - Number(y)
    return by !== 0 ? sign * by : b.score - a.score
  }
  return items.slice().sort(cmp)
}

// The sort and the pinned Custom Format are remembered for the browser session, across manual searches.
const VIEW_KEY = 'kestrel.manualSearchView'

/** The sort Settings > Display names: `best_first`, or a column and a direction such as `size_desc`. */
function defaultSort(value: string): Sort {
  const [key, dir] = value.split('_')
  return columns.some((c) => c.key === key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : BEST_FIRST
}

/** The view this browser session picked, or null when it has not: then the household's default sort stands. */
function loadView(): View | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as Partial<View> | null
    const s = v?.sort
    if (s && columns.some((c) => c.key === s.key) && (s.dir === 'asc' || s.dir === 'desc')) {
      return { sort: { key: s.key, dir: s.dir }, pinned: typeof v?.pinned === 'string' ? v.pinned : null }
    }
  } catch {
    // no session storage: nothing is remembered
  }
  return null
}

function saveView(v: View) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(v))
  } catch {
    // no session storage: nothing is remembered
  }
}

/**
 * Manual search for one Version: every Release the indexers offered, scored
 * against the Version's Profile, in a keyboard table. j/k select, Enter grabs,
 * Escape goes back; the column headers sort (the order j/k and Enter follow), and a Custom Format chip pins
 * the Releases that match it. Rejected Releases stay below the accepted ones. A Series search can be narrowed to a season or episodes
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
  const phone = usePhone()
  const search = useReleases(versionId, scope?.body)
  const grabbing = useGrab()
  const openPlace = useOpenPlace()
  const [hideRejected, setHideRejected] = useState(false)
  const { display } = useDisplay()
  const [picked, setView] = useState(loadView)
  const view = useMemo<View>(() => picked ?? { sort: defaultSort(display.manual_search_sort), pinned: null }, [picked, display.manual_search_sort])
  const [sel, setSel] = useState(0)
  const [sent, setSent] = useState<string | null>(null)
  // The Releases grabbed in this search, by their id in the result list; they stay marked while the selection or sort moves.
  const [grabbed, setGrabbed] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const all = search.data?.items ?? []
  const rows = useMemo(() => arrange(hideRejected ? all.filter((r) => r.rejections.length === 0) : all, view), [all, hideRejected, view])
  const index = Math.min(sel, Math.max(rows.length - 1, 0))
  const current = rows[index] as Release | undefined
  const g = current && grabState(current)

  // After a mouse click the section takes the focus back, so Enter grabs rather than pressing the header or chip
  // again; a keyboard activation (detail 0) keeps the focus where the keyboard user is.
  const change = (next: View, e: { detail: number }) => {
    setView(next)
    saveView(next)
    setSel(0)
    if (e.detail > 0) ref.current?.focus()
  }
  const sortBy = (key: SortKey, e: { detail: number }) => change({ ...view, sort: view.sort.key === key ? { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' } }, e)
  const isBest = view.sort.key === BEST_FIRST.key && view.sort.dir === BEST_FIRST.dir
  const summary = (
    <span className="copy-13 text-gray-900">
      Profile {profileName} · {rows.length} Releases ·{' '}
      {isBest ? 'best first' : `sorted by ${columns.find((c) => c.key === view.sort.key)?.label.toLowerCase()}, ${view.sort.dir === 'asc' ? 'ascending' : 'descending'}`}
    </span>
  )
  const pin = (name: string, e: { detail: number }) => change({ ...view, pinned: view.pinned === name ? null : name }, e)

  const grab = () => {
    if (!current || !g || g.disabled || grabbing.isPending) return
    setSent(null)
    setProblem(null)
    grabbing.mutate(
      { version_id: versionId, release_id: current.release_id, override: g.override },
      {
        onSuccess: () => {
          setSent(current.name)
          setGrabbed((was) => new Set(was).add(current.release_id))
        },
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

  const skeleton = [0, 1, 2, 3, 4, 5].map((i) => <Table.SkeletonRow key={i} index={i} columns={skeletonColumns} />)
  const errors = search.data?.indexer_errors ?? []
  return (
    <section ref={ref} tabIndex={-1} aria-label="Manual search" className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
      {phone ? (
        <PhoneHeader
          back={
            <Button variant="secondary" size="small" prefix={<ArrowLeft />} onClick={onBack} className="self-start">
              {titleName}
            </Button>
          }
          badges={
            <>
              <Badge variant="gray" contrast="low" size="sm">
                {slotLabel}
              </Badge>
              {scope && (
                <Badge variant="gray" contrast="low" size="sm">
                  {scope.label}
                </Badge>
              )}
            </>
          }
          summary={summary}
        >
          <Select
            size="small"
            label="Sort"
            labelPosition="inline"
            wrapperClassName="min-w-0"
            value={`${view.sort.key}:${view.sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc']
              change({ ...view, sort: { key, dir } }, { detail: 0 })
            }}
            options={sortOptions}
          />
          <Checkbox checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)}>
            Hide rejected
          </Checkbox>
        </PhoneHeader>
      ) : (
        <PaneHeader>
          <Button variant="secondary" size="small" prefix={<ArrowLeft />} onClick={onBack}>
            {titleName}
          </Button>
          <h2 className="heading-16">Manual search</h2>
          <Badge variant="gray" contrast="low" size="sm">
            {slotLabel}
          </Badge>
          {scope && (
            <Badge variant="gray" contrast="low" size="sm">
              {scope.label}
            </Badge>
          )}
          {summary}
          {!isBest && (
            <Button variant="tertiary" size="small" onClick={(e) => change({ ...view, sort: BEST_FIRST }, e)}>
              Best first
            </Button>
          )}
          <span className="ml-auto">
            <Checkbox checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)}>
              Hide rejected
            </Checkbox>
          </span>
        </PaneHeader>
      )}

      {errors.length > 0 && (
        <FilterStrip>
          <Note variant="warning" size="small" role="alert">
            {errors.map((e) => (
              <div key={`${e.indexer_id}-${e.indexer}`}>
                {e.indexer}: {e.message}
                {e.retry_after ? ` (retry in ${e.retry_after} s)` : ''}
              </div>
            ))}
          </Note>
        </FilterStrip>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {search.isError ? (
          <div className="p-4">
            <Note variant="error" size="small">
              {search.error.message}
            </Note>
          </div>
        ) : phone ? (
          // A phone has no room for eight columns: each Release is a stacked row, and the sort is a Select in the header.
          <Entity.List aria-label="Releases" aria-busy={search.isPending || undefined} className="p-4">
            {rows.map((x, i) => (
              <ReleaseRow
                key={x.release_id}
                x={x}
                index={i}
                current={i === index}
                pinned={view.pinned}
                onSelect={() => setSel(i)}
                onPin={pin}
                marks={grabbed.has(x.release_id) ? <GrabbedBadge /> : undefined}
              />
            ))}
          </Entity.List>
        ) : (
          <Table.Root>
            <Table aria-label="Releases" aria-busy={search.isPending || undefined} stickyHeader>
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
                  {columns.map((c) => (
                    <Table.Head key={c.key} align={c.align} sort={view.sort.key === c.key ? (view.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onSort={(e) => sortBy(c.key, e)}>
                      {c.label}
                    </Table.Head>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body interactive bordered>
                {search.isPending && skeleton}
                {rows.map((x, i) => {
                  const rejected = x.rejections.length > 0
                  const dim = rejected && 'opacity-50'
                  return (
                    <Table.Row key={x.release_id} selected={i === index} data-nav={`ms-${i}`} onClick={() => setSel(i)} onDoubleClick={grab} className="cursor-pointer align-top">
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>
                        {x.score.toLocaleString('en-US')}
                      </Table.Cell>
                      <Table.Cell truncate>
                        <div className={cx('flex items-center gap-1.5', dim)}>
                          <span className="label-12-mono truncate" title={x.name}>
                            {x.name}
                          </span>
                          {x.rejections.some((r) => r.code === 'blocklisted') && (
                            <Badge variant="red" contrast="low" size="sm">
                              Blocklisted
                            </Badge>
                          )}
                          {x.fits === 'other_slot' && (
                            <Badge variant="gray" contrast="low" size="sm">
                              Other Slot
                            </Badge>
                          )}
                          {grabbed.has(x.release_id) && <GrabbedBadge />}
                        </div>
                        {scopeLabel(x) && (
                          <div className={cx('mt-1 flex items-center gap-1.5', dim)}>
                            <Badge variant="gray" contrast="low" size="sm">
                              {scopeLabel(x)}
                            </Badge>
                            {episodeTitles(x) && (
                              <span className="copy-13 min-w-0 truncate text-gray-900" title={shownTitles(x).join(' · ')}>
                                · {episodeTitles(x)}
                              </span>
                            )}
                          </div>
                        )}
                        {rejected && <div className={cx('label-12 mt-0.5', rejectionBlocked(x) ? 'text-red-900' : 'text-amber-900')}>{x.rejections.map((r) => r.message).join(' · ')}</div>}
                      </Table.Cell>
                      <Table.Cell className={dim || undefined}>{x.quality}</Table.Cell>
                      <Table.Cell className={dim || undefined}>{x.languages.join(', ')}</Table.Cell>
                      <Table.Cell wrap className={dim || undefined}>
                        <div className="flex flex-wrap gap-1">
                          {x.custom_formats.map((f) => (
                            <Pill
                              key={f.name}
                              size="sm"
                              pressed={view.pinned === f.name}
                              onPressedChange={() => undefined}
                              onClick={(e) => {
                                e.stopPropagation()
                                change({ ...view, pinned: view.pinned === f.name ? null : f.name }, e.nativeEvent as MouseEvent)
                              }}
                              title={`${f.points} points: pin the Releases with ${f.name} to the top`}
                            >
                              {f.name}
                            </Pill>
                          ))}
                        </div>
                      </Table.Cell>
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>
                        {size(x.size)}
                      </Table.Cell>
                      <Table.Cell align="right" className={cx('hy-num hy-mono', dim)}>
                        {age(x.published_at)}
                      </Table.Cell>
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

      <PaneFooter>
        <div className="min-w-0 flex-1" aria-live="polite">
          {sent && (
            <div className="label-12 flex min-w-0 items-center gap-2 text-green-900">
              <span className="truncate">Sent to the download client: {sent}</span>
              <Link as="button" className="shrink-0" onClick={() => openPlace(placePath('activity'))}>
                View in Activity
              </Link>
            </div>
          )}
          {problem ? (
            <ErrorMessage size="small" label={false} role="alert">
              {problem}
            </ErrorMessage>
          ) : current && g ? (
            <>
              <div className="label-12-mono truncate">
                {current.name}{' '}
                <span className="text-gray-900">
                  · {current.score.toLocaleString('en-US')} · {size(current.size)} · {current.indexer}
                </span>
              </div>
              <div className={cx('label-12 truncate', g.disabled ? 'text-red-900' : g.reason ? 'text-amber-900' : 'text-gray-900')}>
                {g.reason ?? `Fits the ${slotLabel} Version under Profile ${profileName}`}
              </div>
            </>
          ) : null}
        </div>
        {!phone && (
          <span className="label-12 flex items-center gap-1 text-gray-900">
            <KeyboardInput small>j</KeyboardInput>
            <KeyboardInput small>k</KeyboardInput> select · <KeyboardInput small>↵</KeyboardInput> grab · <KeyboardInput small>esc</KeyboardInput> back
          </span>
        )}
        {g && (
          <Button
            variant={g.override ? 'secondary' : 'primary'}
            size="small"
            prefix={<Download />}
            loading={grabbing.isPending}
            disabled={g.disabled || grabbing.isPending}
            onClick={grab}
            title={g.reason}
          >
            {grabbing.isPending ? 'Grabbing…' : g.label}
          </Button>
        )}
      </PaneFooter>
    </section>
  )
}

/** The mark on a Release grabbed in this search. */
function GrabbedBadge() {
  return (
    <Badge variant="green" contrast="low" size="sm">
      Grabbed
    </Badge>
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

/** The titles of a Release's episodes; an empty title (an episode without one) shows as TBA, as on the episode grid. */
function shownTitles(x: Release): string[] {
  return (x.episode_titles ?? []).map((title) => title || 'TBA')
}

/** The titles of the episodes a Release names: the first two, then "+N more" when it names more. */
function episodeTitles(x: Release): string | null {
  const titles = shownTitles(x)
  if (titles.length === 0) return null
  return titles.length > 2 ? `${titles.slice(0, 2).join(' / ')} / +${titles.length - 2} more` : titles.join(' / ')
}

/** The sort a phone offers in place of the column headers: best first, then each column both ways. */
const sortOptions = [
  { value: `${BEST_FIRST.key}:${BEST_FIRST.dir}`, label: 'Best first' },
  ...columns.flatMap((c) =>
    (['asc', 'desc'] as const)
      .filter((dir) => !(c.key === BEST_FIRST.key && dir === BEST_FIRST.dir))
      .map((dir) => ({ value: `${c.key}:${dir}`, label: `${c.label}, ${dir === 'asc' ? 'ascending' : 'descending'}` })),
  ),
]

/** A phone's header: Back on its own line, then the Version, its summary and the controls. */
function PhoneHeader({ back, badges, summary, children }: { back: ReactNode; badges: ReactNode; summary: ReactNode; children: ReactNode }) {
  return (
    <PaneHeader stacked>
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="heading-16">Manual search</h2>
        {badges}
      </div>
      {summary}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
    </PaneHeader>
  )
}

/**
 * A Release as a phone's stacked row: its name and Score, then Quality, Size, Age, Indexer and the Custom Formats as
 * Pills, then why it was rejected. `marks` goes after the name, for a Badge such as "Grabbed".
 */
function ReleaseRow({
  x,
  index,
  current,
  pinned,
  onSelect,
  onPin,
  marks,
}: {
  x: Release
  index: number
  current: boolean
  pinned: string | null
  onSelect: () => void
  onPin: (name: string, e: { detail: number }) => void
  marks?: ReactNode
}) {
  const rejected = x.rejections.length > 0
  const dim = rejected && 'opacity-50'
  return (
    <Entity current={current} data-nav={`ms-${index}`}>
      <div className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <span className={cx('label-12-mono min-w-0 break-all', dim)} title={x.name}>
            {x.name}
          </span>
          <span className={cx('hy-num hy-mono shrink-0', dim)}>{x.score.toLocaleString('en-US')}</span>
        </div>
        <div className={cx('flex flex-wrap items-center gap-1', dim)}>
          {x.rejections.some((r) => r.code === 'blocklisted') && (
            <Badge variant="red" contrast="low" size="sm">
              Blocklisted
            </Badge>
          )}
          {x.fits === 'other_slot' && (
            <Badge variant="gray" contrast="low" size="sm">
              Other Slot
            </Badge>
          )}
          {scopeLabel(x) && (
            <Badge variant="gray" contrast="low" size="sm">
              {scopeLabel(x)}
            </Badge>
          )}
          {marks}
          <Pill size="sm">{x.quality}</Pill>
          <Pill size="sm">{size(x.size)}</Pill>
          <Pill size="sm">{age(x.published_at)}</Pill>
          <Pill size="sm">{x.indexer}</Pill>
          {x.custom_formats.map((f) => (
            <Pill
              key={f.name}
              size="sm"
              pressed={pinned === f.name}
              onPressedChange={() => undefined}
              onClick={(e) => {
                e.stopPropagation()
                onPin(f.name, e.nativeEvent as MouseEvent)
              }}
              title={`${f.points} points: pin the Releases with ${f.name} to the top`}
            >
              {f.name}
            </Pill>
          ))}
        </div>
        {episodeTitles(x) && <div className={cx('copy-13 text-gray-900', dim)}>{episodeTitles(x)}</div>}
        {rejected && <div className={cx('label-12', rejectionBlocked(x) ? 'text-red-900' : 'text-amber-900')}>{x.rejections.map((r) => r.message).join(' · ')}</div>}
      </div>
    </Entity>
  )
}
