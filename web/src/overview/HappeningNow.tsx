// Happening now: above two equal cards, Downloading (left) and Searching (right, with the Wanted list), the Needs attention
// card: the rows the server raised, with the actions it built, then the groups (an Adoption plan, Originals available), one
// slim line each. Nothing here knows a kind of row; it draws message, severity and buttons. Long Missing is not here: the
// Searching card's Wanted line counts it and opens the Library on it.
import { Button, DotsMenu, Icon, MenuItem, Note } from '@hyprsh/design'
import { ClipboardList, Languages, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAttention, type ActionResult, type AttentionRow } from '../api/attention'
import type { OriginalsAvailable } from '../api/offers'
import { useTitles } from '../api/queries'
import { useQueue } from '../api/queue'
import { useSearchStatus } from '../api/search'
import { useCancel } from '../grabs/useCancel'
import { planWaiting, useAdoption, type Adoption } from '../api/adoption'
import { NowCard, NowList, NowRow } from '../layout/NowCard'
import { useAttentionAction } from './useAttentionAction'
import { Offers } from './OriginalsRow'
import { DownloadingCard } from './Downloads'
import { SearchingCard, wantedLinePath } from './SearchingCard'
import { wantedVersions } from './wanted'
import type { OverviewNav } from './nav'
import { firstFive, ViewAllHere } from './Section'

/**
 * The rows on show: five, or all of them once expanded. Blocking rows always show, so a
 * Blocking row past the fifth is never hidden behind "View all".
 */
const shownRows = (rows: AttentionRow[], all: boolean) => (all ? rows : firstFive(rows, (r) => r.severity === 'blocking'))

/** How many Wanted Versions the Searching card lists. */
const WANTED_SHOWN = 5

type Group = 'adoption' | 'originals'

/** How long a finished search pass stays as a row, in ms. */
const FINISHED_ROW_MS = 60_000
type LastPass = NonNullable<NonNullable<ReturnType<typeof useSearchStatus>['data']>['last_pass']>

/**
 * The pass that has just finished, while it is still worth a row: the search status's `last_pass` for a minute after it
 * ended (from any tab, and whether this one saw it end), until dismissed. Null while a pass runs.
 */
function useFinishedPass(running: boolean, last: LastPass | null | undefined): { pass: LastPass | null; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [, tick] = useState(0)
  const finished = last ? Date.parse(last.finished_at) : null
  // Re-render once the minute is up, so the row goes without waiting for the next frame.
  useEffect(() => {
    if (finished === null) return
    const left = FINISHED_ROW_MS - (Date.now() - finished)
    if (left <= 0) return
    const id = setTimeout(() => tick((n) => n + 1), left + 20)
    return () => clearTimeout(id)
  }, [finished])
  // A pass that found nothing to search is not news: the Search loop runs one every few minutes.
  const show = !running && last && (last.searched > 0 || last.upgrades > 0 || last.grabbed > 0) && finished !== null && dismissed !== last.finished_at && Date.now() - finished < FINISHED_ROW_MS
  return { pass: show ? last : null, dismiss: () => last && setDismissed(last.finished_at) }
}

/**
 * What the section shows and the Overview's j/k list needs to know: the Overview calls this and hands the result
 * to `HappeningNow`, so the selection runs through exactly the rows on screen (attention rows, groups, downloads,
 * the search pass, the Wanted line and its rows).
 */
export function useHappeningNow(onOpen: (path: string) => void, onOpenTitle: (id: number) => void, onOpenAdoption: () => void) {
  const attention = useAttention()
  const queue = useQueue()
  const adoption = useAdoption().data
  const titles = useTitles()
  const status = useSearchStatus().data
  const search = status?.pass ?? null
  const finished = useFinishedPass(search !== null, status?.last_pass)
  const [all, setAll] = useState(false)
  const [originalsOpen, setOriginalsOpen] = useState(false)
  const rows = attention.data?.rows ?? []
  const shown = shownRows(rows, all)
  const downloads = queue.data ?? []
  const items = firstFive(downloads)
  const wanted = wantedVersions(titles.data ?? [])
  const wantedShown = wanted.slice(0, WANTED_SHOWN)
  const wantedLoaded = !titles.isPending
  const longMissing = wanted.filter((w) => w.longMissing).length
  const groups: Group[] = []
  if (adoption && planWaiting(adoption.state)) groups.push('adoption')
  if (attention.data?.originals && attention.data.originals.count > 0) groups.push('originals')
  const toggleOriginals = () => setOriginalsOpen((o) => !o)
  const enter: (() => void)[] = [
    ...shown.map((r) => () => {
      const open = r.actions.find((a) => a.method === 'GET')
      if (open) onOpen(open.path)
    }),
    ...groups.map((g) => () => (g === 'adoption' ? onOpenAdoption() : toggleOriginals())),
    // The left card, top to bottom, then the right: the running search pass (Enter opens the Title it is searching), the
    // Wanted line (Enter opens the Library on the Long Missing ones), then the Wanted rows.
    ...items.map((i) => () => i.title_id != null && onOpenTitle(i.title_id)),
    ...(search ? [() => search.current && onOpenTitle(search.current.title_id)] : finished.pass ? [() => {}] : []),
    ...(wantedLoaded && wanted.length > 0 ? [() => onOpen(wantedLinePath(longMissing))] : []),
    ...wantedShown.map((w) => () => onOpenTitle(w.titleId)),
  ]
  return {
    attention,
    queue,
    adoption,
    all,
    setAll,
    originalsOpen,
    toggleOriginals,
    rows,
    shown,
    downloads,
    items,
    groups,
    search,
    finished,
    nextPassAt: status?.next_pass_at ?? null,
    wanted,
    wantedShown,
    wantedLoaded,
    enter,
    loaded: !attention.isPending && !queue.isPending,
  }
}

export type HappeningNowModel = ReturnType<typeof useHappeningNow>

export function HappeningNow({
  model,
  onOpen,
  onOpenTitle,
  onOpenAdoption,
  nav,
}: {
  model: HappeningNowModel
  onOpen: (path: string) => void
  onOpenTitle: (id: number) => void
  onOpenAdoption: () => void
  nav: OverviewNav
}) {
  const cancel = useCancel()
  const { attention, adoption, all, setAll, originalsOpen, toggleOriginals, rows, shown, downloads, items, groups, search, finished, loaded } = model
  const groupBase = nav.base + shown.length
  const downloadBase = groupBase + groups.length
  const searchBase = downloadBase + items.length
  return (
    <div className="flex flex-col gap-4">
      {loaded && (shown.length > 0 || groups.length > 0) && (
        <NowCard title="Needs attention" label={rows.length ? `Needs attention · ${rows.length}` : 'Needs attention'} meta={rows.length || undefined}>
          <NowList>
            {shown.map((r, i) => (
              <Row key={r.id} row={r} onOpen={onOpen} nav={nav} index={nav.base + i} />
            ))}
            {groups.map((g, i) => {
              const index = groupBase + i
              if (g === 'adoption' && adoption) return <AdoptionPlanRow key={g} adoption={adoption} onOpen={onOpenAdoption} nav={nav} index={index} />
              if (g === 'originals' && attention.data?.originals)
                return <OriginalsGroupRow key={g} group={attention.data.originals} open={originalsOpen} onToggle={toggleOriginals} onOpenTitle={onOpenTitle} nav={nav} index={index} />
              return null
            })}
          </NowList>
          {(all || shown.length < rows.length) && (
            <div className="px-4 pb-2">
              <ViewAllHere count={rows.length} open={all} onToggle={() => setAll(!all)} />
            </div>
          )}
        </NowCard>
      )}
      {/* Two equal cards side by side; below 720px of width they stack. */}
      <div className="grid grid-cols-1 items-stretch gap-4 @[720px]:grid-cols-2">
        <DownloadingCard
          items={items}
          all={downloads}
          firstIndex={downloadBase}
          nav={nav}
          loaded={loaded}
          busy={cancel.pending}
          onCancel={(id, blocklist) => void cancel.run(id, blocklist)}
          onOpenTitle={onOpenTitle}
        />
        <SearchingCard
          pass={search}
          finished={finished.pass}
          onDismiss={finished.dismiss}
          nextPassAt={model.nextPassAt}
          wanted={model.wanted}
          shown={model.wantedShown}
          wantedLoaded={model.wantedLoaded}
          searchIndex={searchBase}
          nav={nav}
          onOpenTitle={onOpenTitle}
        />
      </div>
    </div>
  )
}

/** One slim line of the card: an icon, the message (and what an action said) and the line's action at the far end. */
function Line({ index, nav, icon, children, actions, ...data }: { index: number; nav: OverviewNav; icon: ReactNode; children: ReactNode; actions?: ReactNode; [k: `data-${string}`]: boolean }) {
  return (
    <NowRow
      navIndex={index}
      current={index === nav.sel}
      onSelect={() => nav.select(index)}
      lead={icon}
      right={actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
      {...data}
    >
      {children}
    </NowRow>
  )
}

const message = (text: string) => <span className="label-14 min-w-0 whitespace-normal">{text}</span>

const adoptionMessage = (a: Adoption) =>
  a.state === 'scanning'
    ? 'An Adoption scan is running'
    : a.state === 'committing'
      ? 'An Adoption plan is being committed'
      : `An Adoption plan is waiting for review${a.summary.needs_choice > 0 ? ` (${a.summary.needs_choice} need a choice)` : ''}`

/** A stored Adoption plan, as one line outside the rail badge: a new scan replaces it, so this points back to it. */
function AdoptionPlanRow({ adoption, onOpen, nav, index }: { adoption: Adoption; onOpen: () => void; nav: OverviewNav; index: number }) {
  return (
    <Line
      data-adoption-plan
      index={index}
      nav={nav}
      icon={<Icon icon={ClipboardList} color="var(--amber-900)" />}
      actions={
        <Button variant="tertiary" size="small" onClick={onOpen}>
          Review the Adoption Plan
        </Button>
      }
    >
      {message(adoptionMessage(adoption))}
    </Line>
  )
}

/** One line outside the rail badge; it expands to one row per Version, best Release first. */
function OriginalsGroupRow({
  group,
  open,
  onToggle,
  onOpenTitle,
  nav,
  index,
}: {
  group: OriginalsAvailable
  open: boolean
  onToggle: () => void
  onOpenTitle: (id: number) => void
  nav: OverviewNav
  index: number
}) {
  const title = `Originals available · ${group.count}`
  return (
    <>
      <Line
        data-originals
        index={index}
        nav={nav}
        icon={<Icon icon={Languages} color="var(--gray-900)" />}
        actions={
          <Button variant="tertiary" size="small" aria-label={title} aria-expanded={open} onClick={onToggle}>
            {open ? 'Hide' : 'Show'}
          </Button>
        }
      >
        {message(title)}
      </Line>
      {open && <Offers group={group} onOpenTitle={onOpenTitle} />}
    </>
  )
}

function Row({ row, onOpen, nav, index }: { row: AttentionRow; onOpen: (path: string) => void; nav: OverviewNav; index: number }) {
  const { act, pending, error, result, dialog } = useAttentionAction(onOpen)
  const blocking = row.severity === 'blocking'
  const [first, ...rest] = row.actions
  const actions = first && (
    <>
      <Button variant="tertiary" size="small" disabled={pending} onClick={() => act(first)}>
        {first.label}
      </Button>
      {rest.length > 0 && (
        <DotsMenu aria-label="More Actions" disabled={pending}>
          {rest.map((a) => (
            <MenuItem key={a.key} onClick={() => act(a)}>
              {a.label}
            </MenuItem>
          ))}
        </DotsMenu>
      )}
    </>
  )

  return (
    <>
      <Line
        index={index}
        nav={nav}
        icon={<Icon icon={blocking ? OctagonAlert : TriangleAlert} color={blocking ? 'var(--red-900)' : 'var(--amber-900)'} label={blocking ? 'Blocking' : 'Warning'} />}
        actions={actions}
      >
        {message(row.message)}
        {error && <Note variant="error">{error.message}</Note>}
        {result && <Result {...result} />}
      </Line>
      {dialog}
    </>
  )
}

/** A failure is an error Note; an answer without a verdict (`ok` null) is just its message. A pass is a toast, so it never gets here. */
function Result({ label, ok, message }: ActionResult & { label: string }) {
  if (ok === null) return message ? <p className="label-12 m-0 text-gray-900">{message}</p> : null
  return (
    <Note variant="error" size="small">
      {label} failed{message ? `: ${message}` : ''}
    </Note>
  )
}
