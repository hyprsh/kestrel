import { Badge, Button, DotsMenu, Entity, EmptyState, Link, Menu, MenuDivider, MenuItem, Note, Pager, Table, Tabs, useToasts } from '@hyprsh/design'
import { ArrowLeft, ChevronRight, ChevronUp, Download, RefreshCw } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ApiError } from '../api/queries'
import { useBlocklistRelease, useGrab, useReleases, type Release } from '../api/grabs'
import type { EpisodeScope } from '../api/queries'
import { useKey, useListNav } from '../keys'
import { placePath, useOpenPlace, usePageParam, useUrlParam } from '../place'
import { useDisplay } from '../display/useDisplay'
import { PagerStrip } from '../layout/PagerStrip'
import { PaneHeader } from '../layout/Pane'
import { TableSkeletonRows } from '../loading'
import { usePhone } from '../responsive'
import { size } from './bits'
import { qualityName } from './media'
import { BestFit, ConfirmGrab, Downloading, FailedActions, FailedText, ReleaseDetail, rowTint, type GrabEntry, type ReleaseActions } from './ReleaseParts'
import {
  ageShort,
  arrange,
  bestFit,
  defaultSort,
  episodeNames,
  fillsReplaces,
  fitsProfile,
  grabState,
  inSegment,
  isSeriesSearch,
  keyOf,
  loadSort,
  rejectedSummary,
  rejectionBlocked,
  saveSort,
  score,
  scopeText,
  segmentCounts,
  sortLabel,
  sortOptions,
  type Segment,
  type Sort,
  type SortKey,
} from './releaseView'

/** Releases per page. */
const PAGE_SIZE = 50

/** The skeleton rows' columns, sized like the real ones. */
const skeletonColumns = [
  { key: 'score', header: 'Score', numeric: true },
  { key: 'release', header: 'Release', mono: true, truncate: true },
  { key: 'size', header: 'Size', numeric: true },
  { key: 'age', header: 'Age', numeric: true },
  { key: 'actions', header: 'Actions' },
]

/** "12 s ago", counting on while the page is open. */
function SearchedAgo({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const secs = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  if (secs < 60) return <>{`${secs} s ago`}</>
  const mins = Math.round(secs / 60)
  return <>{mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}</>
}

/** What a Release row says under its name: the scope and episode titles, quality, languages and indexer, or why it was rejected. */
function Facts({ x }: { x: Release }) {
  if (!fitsProfile(x)) {
    return <span className={`label-12 truncate ${rejectionBlocked(x) ? 'text-red-900' : 'text-amber-900'}`}>{x.rejections.map((r) => r.message).join(' · ')}</span>
  }
  const names = episodeNames(x)
  const titles = names.length > 2 ? `${names.slice(0, 2).join(' / ')} / +${names.length - 2} more` : names.join(' / ')
  const parts = [scopeText(x), titles || null, qualityName(x.quality), x.hdr, x.languages.join(', ') || null, x.indexer].filter(Boolean)
  return (
    <span className="label-12 truncate text-gray-900" title={names.join(' · ') || undefined}>
      {parts.join(' · ')}
    </span>
  )
}

/**
 * Manual search for one Version: every Release the indexers offered, scored against the Version's Profile. The Best fit
 * comes first with its one Grab; the list below shows what fits (or season packs, episodes, the rejected), best first, and
 * folds the rejected Releases into one line. A row opens in place to say why it scores what it does. j/k move, Enter opens
 * or closes a row, g grabs, Escape goes back. A grab that fits and replaces nothing is sent at once; the row then follows
 * the download. A Series search can be narrowed to a season or episodes (`scope`), named in the header by `scope.label`.
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
  const blocklisting = useBlocklistRelease()
  const toasts = useToasts()
  const openPlace = useOpenPlace()
  const [page, setPage] = usePageParam()
  const [, setSortParam] = useUrlParam('sort')
  const { display } = useDisplay()
  const [picked, setPicked] = useState(loadSort)
  const sort = useMemo<Sort>(() => picked ?? defaultSort(display.manual_search_sort), [picked, display.manual_search_sort])
  const [segment, setSegment] = useState<Segment>('fits')
  const [rejectedShown, setRejectedShown] = useState(false)
  const [sel, setSel] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [entries, setEntries] = useState<Readonly<Record<string, GrabEntry>>>({})
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState<Release | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus(), [])
  // A new search starts at the first page.
  useEffect(() => setPage(1), [setPage])
  useEffect(() => () => setPage(1), [setPage])
  // The sort is kept in the address bar (`?sort=size:desc`) while manual search is open.
  useEffect(() => {
    setSortParam(`${sort.key}:${sort.dir}`)
    return () => setSortParam(null)
  }, [sort.key, sort.dir, setSortParam])

  // A Release blocklisted here is rejected from now on, before the next search says so.
  const all = useMemo(
    () =>
      (search.data?.items ?? []).map((r) =>
        blocked.has(keyOf(r)) && !r.rejections.some((x) => x.code === 'blocklisted')
          ? { ...r, rejections: [...r.rejections, { code: 'blocklisted' as const, message: 'On the Blocklist', overridable: false }] }
          : r,
      ),
    [search.data, blocked],
  )
  const series = isSeriesSearch(all)
  const counts = useMemo(() => segmentCounts(all), [all])
  const best = useMemo(() => bestFit(all), [all])
  const summary = useMemo(() => rejectedSummary(all), [all])
  const wantedTotal = search.data?.wanted ?? 0

  // The Releases of the segment, the Best fit left to its card. On the Fits list the rejected ones follow once shown.
  const rows = useMemo(() => {
    const inList = all.filter((r) => inSegment(r, segment) && !(best && keyOf(r) === keyOf(best) && segment !== 'rejected'))
    const list = arrange(inList, sort)
    return segment === 'fits' && rejectedShown
      ? [
          ...list,
          ...arrange(
            all.filter((r) => !fitsProfile(r)),
            sort,
          ),
        ]
      : list
  }, [all, segment, best, sort, rejectedShown])
  const shownPage = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)))
  const pageRows = useMemo(() => rows.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE), [rows, shownPage])
  const index = Math.min(sel, Math.max(pageRows.length - 1, 0))
  const current = pageRows[index] as Release | undefined

  // What the header counts: the Wanted ones, less those a grab made here is on its way to fill. A search that ran after a grab
  // already leaves its episodes out of Wanted, so only the grabs since the last search come off the count.
  const sent = Object.values(entries).filter((e): e is Extract<GrabEntry, { status: 'sent' }> => e.status === 'sent')
  const downloading = new Set(sent.flatMap((e) => e.fills)).size
  const unseen = new Set(sent.filter((e) => e.at > search.dataUpdatedAt).flatMap((e) => e.fills)).size
  const wanted = Math.max(wantedTotal - unseen, 0)

  const setEntry = useCallback((key: string, entry: GrabEntry | null) => {
    setEntries((was) => {
      const next = { ...was }
      if (entry) next[key] = entry
      else delete next[key]
      return next
    })
  }, [])

  const what = (x: Release) =>
    x.pack ? `S${String(x.season ?? 0).padStart(2, '0')} season pack` : (x.episodes ?? []).length > 0 ? `S${String(x.season ?? 0).padStart(2, '0')}${scopeText(x)}` : x.quality

  const send = (x: Release, override: boolean) => {
    const key = keyOf(x)
    setConfirm(null)
    setOpenKey((k) => (k === key ? null : k))
    setEntry(key, { status: 'pending' })
    grabbing.mutateAsync({ version_id: versionId, release_id: x.release_id, override }).then(
      (g) => {
        setEntry(key, { status: 'sent', grabId: g.id, fills: fillsReplaces(x).fills.map((c) => `${c.season ?? ''}x${c.episode ?? ''}`), at: Date.now() })
        toasts.success({ text: `Grabbed for ${slotLabel} · ${what(x)}`, action: { label: `Back to ${titleName}`, onClick: onBack } })
      },
      (e: Error) => {
        setEntry(key, { status: 'failed', message: e.message })
        // The cache forgot the Release (6 h) or the indexer lost it: the list is stale, so search again.
        if (e instanceof ApiError && e.code === 'release_expired') void search.refetch()
      },
    )
  }

  /** Grab asks first only when it overrides a rejection or replaces files; every other grab goes at once. */
  const requestGrab = (x: Release) => {
    const status = entries[keyOf(x)]?.status
    if (status === 'pending' || status === 'sent') return
    const g = grabState(x)
    if (g.disabled) return
    // A retry after a refetch uses the Release as the latest search names it.
    const fresh = all.find((r) => keyOf(r) === keyOf(x)) ?? x
    if (g.override || fillsReplaces(fresh).replaces.length > 0) setConfirm(fresh)
    else send(fresh, false)
  }

  const blocklist = (x: Release) =>
    void blocklisting.mutateAsync({ version_id: versionId, release_id: x.release_id }).then(
      () => {
        setBlocked((was) => new Set(was).add(keyOf(x)))
        setOpenKey(null)
        toasts.success(`Blocklisted ${x.name}`)
      },
      (e: Error) => {
        toasts.error(`Could not blocklist the Release: ${e.message}`)
        if (e instanceof ApiError && e.code === 'release_expired') void search.refetch()
      },
    )

  const copyLink = (x: Release) => {
    if (!x.info_url) return
    void navigator.clipboard?.writeText(x.info_url).then(
      () => toasts.success('Link copied'),
      () => toasts.error('Could not copy the link'),
    )
  }

  // The best Release that fits and has not been grabbed or failed here.
  const nextBest = useMemo(() => bestFit(all.filter((r) => !entries[keyOf(r)])), [all, entries])

  const actions: ReleaseActions = {
    grab: requestGrab,
    blocklist,
    copyLink,
    openActivity: (grabId) => openPlace(placePath('activity', `grab:${grabId}`)),
    failed: (x, message) => setEntry(keyOf(x), { status: 'failed', message }),
    nextBest,
  }

  const changeSort = (next: Sort, e?: { detail: number }) => {
    setPicked(next)
    saveSort(next)
    setPage(1)
    setSel(0)
    if (e && e.detail > 0) ref.current?.focus()
  }
  const sortValue = `${sort.key}:${sort.dir}`
  const pickSort = (value?: string) => {
    const [key, dir] = (value ?? '').split(':') as [SortKey, 'asc' | 'desc']
    if (key && dir) changeSort({ key, dir })
  }
  const toSegment = (s: Segment) => {
    setSegment(s)
    setPage(1)
    setSel(0)
  }
  const toPage = (next: number) => {
    setPage(next)
    setSel(0)
  }
  const toggleOpen = (x: Release | undefined) => {
    if (!x || entries[keyOf(x)]) return
    setOpenKey((k) => (k === keyOf(x) ? null : keyOf(x)))
  }

  // A menu or the confirm owns Escape and the keys while it is open.
  const overlay = confirm !== null
  const menuOpen = () => document.querySelector('[role="menu"]') !== null
  useListNav('ms', pageRows.length, index, setSel, () => toggleOpen(current), !overlay)
  useKey('g', () => current && requestGrab(current), !overlay)
  useKey('Escape', () => !menuOpen() && onBack(), !overlay)

  // One handler on the list: a click anywhere on a row, padding included, selects it and opens or closes it.
  const clickRow = (e: ReactMouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a')) return
    const at = /^ms-(\d+)$/.exec(target.closest('[data-nav]')?.getAttribute('data-nav') ?? '')
    if (!at) return
    setSel(Number(at[1]))
    toggleOpen(pageRows[Number(at[1])])
    ref.current?.focus()
  }

  const errors = search.data?.indexer_errors ?? []
  const nIndexers = search.data?.indexers_searched ?? 0
  const status = search.isPending ? (
    'Searching your indexers…'
  ) : search.data ? (
    <>
      {search.data.cached ? (
        <>
          {'From a search '}
          <SearchedAgo at={search.data.searched_at} />
          {' · '}
          <Link as="button" onClick={() => void search.refetch()}>
            Search again
          </Link>
        </>
      ) : (
        <>
          {`${nIndexers} ${nIndexers === 1 ? 'indexer' : 'indexers'} searched `}
          <SearchedAgo at={search.data.searched_at} />
        </>
      )}
      {` · ${all.length} ${all.length === 1 ? 'release' : 'releases'} · ${counts.fits} fit the Profile`}
      {errors.map((e) => (
        <Fragment key={`${e.indexer_id}-${e.indexer}`}>{` · ${e.indexer}: ${e.message}${e.retry_after ? ` (retry in ${e.retry_after} s)` : ''}`}</Fragment>
      ))}
      {errors.length > 0 && (
        <>
          {', '}
          <Link as="button" onClick={() => void search.refetch()}>
            retry
          </Link>
        </>
      )}
    </>
  ) : null

  const back = (
    <Button variant="secondary" size={phone ? 'medium' : 'small'} svgOnly aria-label={`Back to ${titleName}`} onClick={onBack}>
      <ArrowLeft />
    </Button>
  )
  const options = (
    <DotsMenu aria-label="Manual search options" size={phone ? 'medium' : 'small'}>
      <MenuItem disabled={search.isFetching} onSelect={() => void search.refetch()}>
        Search again
      </MenuItem>
      {phone && (
        <>
          <MenuDivider />
          {sortOptions.map((o) => (
            <MenuItem key={o.value} checked={o.value === sortValue} role="radio" onSelect={() => pickSort(o.value)}>
              {o.label}
            </MenuItem>
          ))}
        </>
      )}
    </DotsMenu>
  )
  const badges = (
    <>
      <span className="label-14 font-semibold">{titleName}</span>
      {scope && (
        <Badge variant="gray" contrast="low" size="sm">
          {scope.label}
        </Badge>
      )}
      <Badge variant="gray" contrast="low" size="sm">
        {`${slotLabel} · ${profileName}`}
      </Badge>
      {wanted > 0 && (
        <Badge variant="amber" contrast="low" size="sm">
          {`${wanted} Wanted`}
        </Badge>
      )}
      {downloading > 0 && (
        <Badge variant="blue" contrast="low" size="sm">
          {`${downloading} downloading`}
        </Badge>
      )}
    </>
  )

  const segments = [
    { value: 'fits', title: `Fits ${counts.fits}` },
    ...(series
      ? [
          { value: 'packs', title: `${phone ? 'Packs' : 'Season packs'} ${counts.packs}` },
          { value: 'episodes', title: `Episodes ${counts.episodes}` },
        ]
      : []),
    { value: 'rejected', title: `Rejected ${counts.rejected}` },
  ]

  const sortButton = (
    <Menu.Container position="bottom-end">
      <Menu.Button variant="secondary" size="small" showChevron aria-label={`Sort releases: ${sortLabel(sort)}`}>
        {sortLabel(sort)}
      </Menu.Button>
      <Menu width={240}>
        {sortOptions.map((o) => (
          <MenuItem key={o.value} checked={o.value === sortValue} role="radio" onSelect={() => pickSort(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )

  const hasRejectedRow = segment === 'fits' && summary.total > 0
  const summaryRow = hasRejectedRow && (
    <Table.Row>
      <Table.Cell colSpan={5} wrap>
        <Link as="button" className="flex w-full items-center gap-2.5 text-left" onClick={() => setRejectedShown((v) => !v)} aria-expanded={rejectedShown}>
          {rejectedShown ? <ChevronUp size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <span className="label-13 min-w-0 flex-1 text-gray-900">
            <b className="text-gray-1000">{`${summary.total} rejected`}</b>
            {summary.groups.map((g) => ` · ${g}`).join('')}
          </span>
          <span className="label-13">{rejectedShown ? 'Hide' : 'Show'}</span>
        </Link>
      </Table.Cell>
    </Table.Row>
  )

  return (
    <section ref={ref} tabIndex={-1} aria-label="Manual search" className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
      {phone && (
        <PaneHeader stacked>
          <div className="flex items-center gap-2">
            {back}
            <h1 className="heading-20 flex-1">Manual search</h1>
            {options}
          </div>
          <div className="flex flex-wrap items-center gap-2">{badges}</div>
        </PaneHeader>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:px-8 sm:py-6">
        <div className="flex max-w-5xl flex-col gap-5">
          {!phone && (
            <header className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                {back}
                <h1 className="heading-24 flex-1">Manual search</h1>
                <Button variant="tertiary" size="small" svgOnly aria-label="Search again" loading={search.isFetching} onClick={() => void search.refetch()}>
                  <RefreshCw />
                </Button>
                {options}
              </div>
              <div className="flex flex-wrap items-center gap-2">{badges}</div>
              <span className="label-13 text-gray-900" aria-live="polite">
                {status}
              </span>
            </header>
          )}
          {phone && (
            <span className="label-13 text-gray-900" aria-live="polite">
              {status}
            </span>
          )}

          {search.isError && (
            <Note variant="error" size="small">
              {search.error.message}
            </Note>
          )}

          {best && <BestFit x={best} wanted={wantedTotal} entry={entries[keyOf(best)]} actions={actions} phone={phone} />}

          <section aria-label="Releases" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="max-w-full min-w-0 overflow-x-auto">
                <Tabs variant="secondary" aria-label="Show" tabs={segments} selected={segment} onChange={(v) => toSegment(v as Segment)} />
              </div>
              <span className="flex-1" />
              {!phone && sortButton}
            </div>

            {phone ? (
              <Entity.List aria-label="Releases" aria-busy={search.isPending || undefined} onClick={clickRow}>
                {pageRows.map((x, i) => {
                  const key = keyOf(x)
                  const entry = entries[key]
                  const open = openKey === key && !entry
                  const g = grabState(x)
                  return (
                    <Fragment key={key}>
                      <Entity
                        current={i === index}
                        data-nav={`ms-${i}`}
                        style={rowTint(entry)}
                        className="cursor-pointer"
                        left={<span className="hy-num hy-mono w-11 text-right font-semibold">{score(x.score)}</span>}
                        right={
                          entry ? undefined : (
                            <Button
                              variant="secondary"
                              size="medium"
                              svgOnly
                              aria-label={`${g.override ? 'Grab anyway' : 'Grab'} ${x.name}`}
                              disabled={g.disabled}
                              title={g.reason}
                              onClick={() => requestGrab(x)}
                            >
                              <Download />
                            </Button>
                          )
                        }
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className={open ? 'label-12-mono break-all' : 'label-12-mono truncate'} title={x.name}>
                            {x.name}
                          </span>
                          {entry?.status === 'sent' ? (
                            <>
                              <Downloading entry={entry} x={x} actions={actions} part="bar" />
                              <Downloading entry={entry} x={x} actions={actions} part="text" />
                            </>
                          ) : entry?.status === 'failed' ? (
                            <>
                              <FailedText message={entry.message} />
                              <FailedActions x={x} actions={actions} />
                            </>
                          ) : entry?.status === 'pending' ? (
                            <span className="label-12 text-gray-900">Grabbing…</span>
                          ) : (
                            <span className="flex min-w-0">
                              <Facts x={x} />
                              <span className="label-12 shrink-0 text-gray-900">{` · ${size(x.size)} · ${ageShort(x.published_at)}`}</span>
                            </span>
                          )}
                        </div>
                      </Entity>
                      {open && (
                        <Entity current>
                          <div className="min-w-0 flex-1">
                            <ReleaseDetail x={x} profileName={profileName} bestScore={best?.score} isBest={false} actions={actions} blocklisted={x.rejections.some((r) => r.code === 'blocklisted')} />
                          </div>
                        </Entity>
                      )}
                    </Fragment>
                  )
                })}
              </Entity.List>
            ) : (
              <Table.Root>
                <Table key={search.isPending ? 'loading' : 'ready'} aria-label="Releases" aria-busy={search.isPending || undefined}>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head align="right" className="w-20">
                        Score
                      </Table.Head>
                      <Table.Head>Release</Table.Head>
                      <Table.Head align="right" className="w-24">
                        Size
                      </Table.Head>
                      <Table.Head align="right" className="w-16">
                        Age
                      </Table.Head>
                      <Table.Head className="w-24">
                        <span className="sr-only">Actions</span>
                      </Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body interactive bordered>
                    {search.isPending && <TableSkeletonRows columns={skeletonColumns} />}
                    {pageRows.map((x, i) => {
                      const key = keyOf(x)
                      const entry = entries[key]
                      const open = openKey === key && !entry
                      const rejected = !fitsProfile(x)
                      const g = grabState(x)
                      const dim = rejected && !open ? 'text-gray-900' : ''
                      return (
                        <Fragment key={key}>
                          <Table.Row selected={i === index} current={open} data-nav={`ms-${i}`} onClick={clickRow} className="group cursor-pointer align-top" style={rowTint(entry)}>
                            <Table.Cell align="right" className={`hy-num hy-mono font-semibold ${dim}`}>
                              {score(x.score)}
                            </Table.Cell>
                            <Table.Cell truncate={!open} wrap={open}>
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className={open ? 'label-13-mono break-all' : 'label-13-mono truncate'} title={x.name}>
                                  {x.name}
                                </span>
                                {entry?.status === 'sent' ? (
                                  <Downloading entry={entry} x={x} actions={actions} part="bar" />
                                ) : entry?.status === 'failed' ? (
                                  <FailedText message={entry.message} />
                                ) : entry?.status === 'pending' ? (
                                  <span className="label-12 text-gray-900">Grabbing…</span>
                                ) : (
                                  !open && <Facts x={x} />
                                )}
                              </div>
                            </Table.Cell>
                            {entry?.status === 'sent' || entry?.status === 'failed' ? (
                              <Table.Cell colSpan={3} align="right" wrap>
                                {entry.status === 'sent' ? <Downloading entry={entry} x={x} actions={actions} part="text" /> : <FailedActions x={x} actions={actions} />}
                              </Table.Cell>
                            ) : (
                              <>
                                <Table.Cell align="right" className={`hy-num hy-mono ${dim}`}>
                                  {size(x.size)}
                                </Table.Cell>
                                <Table.Cell align="right" className="hy-num hy-mono text-gray-900">
                                  {ageShort(x.published_at)}
                                </Table.Cell>
                                <Table.Cell align="right">
                                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                    {open ? (
                                      <Button variant="tertiary" size="tiny" svgOnly aria-label="Close" onClick={() => setOpenKey(null)}>
                                        <ChevronUp />
                                      </Button>
                                    ) : (
                                      <span className={`flex gap-1 ${i === index ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}>
                                        <Button
                                          variant="tertiary"
                                          size="tiny"
                                          svgOnly
                                          aria-label={`${g.override ? 'Grab anyway' : 'Grab'} ${x.name}`}
                                          disabled={g.disabled || entry?.status === 'pending'}
                                          title={g.reason}
                                          onClick={() => requestGrab(x)}
                                        >
                                          <Download />
                                        </Button>
                                        <DotsMenu aria-label={`More for ${x.name}`} size="tiny">
                                          <MenuItem onSelect={() => toggleOpen(x)}>Details</MenuItem>
                                          <MenuItem disabled={g.disabled} onSelect={() => requestGrab(x)}>
                                            {g.override ? 'Grab Anyway…' : 'Grab'}
                                          </MenuItem>
                                          <MenuItem disabled={x.rejections.some((r) => r.code === 'blocklisted')} onSelect={() => blocklist(x)}>
                                            Blocklist
                                          </MenuItem>
                                          <MenuItem disabled={!x.info_url} onSelect={() => copyLink(x)}>
                                            Copy Link
                                          </MenuItem>
                                        </DotsMenu>
                                      </span>
                                    )}
                                  </div>
                                </Table.Cell>
                              </>
                            )}
                          </Table.Row>
                          {open && (
                            <Table.Row current>
                              <Table.Cell colSpan={5} wrap className="pt-0 pb-4 pl-24">
                                <ReleaseDetail
                                  x={x}
                                  profileName={profileName}
                                  bestScore={best?.score}
                                  isBest={false}
                                  actions={actions}
                                  blocklisted={x.rejections.some((r) => r.code === 'blocklisted')}
                                />
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Fragment>
                      )
                    })}
                    {summaryRow}
                  </Table.Body>
                </Table>
              </Table.Root>
            )}
            {phone && hasRejectedRow && (
              <Link as="button" className="label-13 text-left text-gray-900" onClick={() => setRejectedShown((v) => !v)} aria-expanded={rejectedShown}>
                {`${summary.total} rejected${summary.groups.map((g) => ` · ${g}`).join('')} · ${rejectedShown ? 'Hide' : 'Show'}`}
              </Link>
            )}

            {search.isSuccess &&
              pageRows.length === 0 &&
              (all.length === 0 ? (
                <EmptyState title="No Releases found." />
              ) : segment === 'fits' && counts.fits === 0 ? (
                <EmptyState title="No Release fits the Profile." description={`${counts.rejected} rejected ${counts.rejected === 1 ? 'Release is' : 'Releases are'} hidden.`}>
                  <Button variant="secondary" size="small" onClick={() => toSegment('rejected')}>
                    Show rejected
                  </Button>
                </EmptyState>
              ) : best && rows.length === 0 && segment === 'fits' ? null : (
                <EmptyState title="No Releases here." />
              ))}
            {!phone && <span className="label-12 text-gray-900">j k move · ↵ open · g grab · esc back</span>}
          </section>
        </div>
      </div>
      {rows.length > PAGE_SIZE && (
        <PagerStrip>
          <Pager aria-label="Release pages" page={shownPage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={toPage} />
        </PagerStrip>
      )}
      {confirm && <ConfirmGrab x={confirm} slotLabel={slotLabel} onCancel={() => setConfirm(null)} onConfirm={() => send(confirm, grabState(confirm).override)} />}
    </section>
  )
}
