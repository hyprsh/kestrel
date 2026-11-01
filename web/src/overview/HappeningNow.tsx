// Happening now: above two equal cards, Downloading (left) and Searching (right, with the Wanted list), the Needs
// attention rows the server raised, with the actions it built, then the groups (an Adoption plan, Long Missing,
// Originals available), all rows of one card. Nothing here knows a kind of row; it draws message, severity and buttons.
import { Badge, Button, DotsMenu, Entity, Icon, MenuItem, Note } from '@hyprsh/design'
import { RowList, stackedRow, stackedRight } from '../layout/RowList'
import { useEffect, useState, type ReactNode } from 'react'
import { useAttention, type ActionResult, type Attention, type AttentionRow } from '../api/attention'
import type { OriginalsAvailable } from '../api/offers'
import { useTitles } from '../api/queries'
import { useQueue } from '../api/queue'
import { useSearchStatus } from '../api/search'
import { useCancel } from '../grabs/useCancel'
import { planWaiting, useAdoption, type Adoption } from '../api/adoption'
import { profileName, slotProfile, useProfileNames } from '../library/slotProfile'
import { placePath } from '../place'
import { TitlePoster } from '../poster'
import { useAttentionAction } from './useAttentionAction'
import { Offers } from './OriginalsRow'
import { DownloadingCard } from './Downloads'
import { SearchingCard } from './SearchingCard'
import { wantedVersions } from './wanted'
import type { OverviewNav } from './nav'
import { firstFive, Section, ViewAllHere } from './Section'

/**
 * The rows on show: five, or all of them once expanded. Blocking rows always show, so a
 * Blocking row past the fifth is never hidden behind "View all".
 */
const shownRows = (rows: AttentionRow[], all: boolean) => (all ? rows : firstFive(rows, (r) => r.severity === 'blocking'))

/** How many Wanted Versions the Searching card lists. */
const WANTED_SHOWN = 5

type Group = 'adoption' | 'long-missing' | 'originals'

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
 * to `HappeningNow`, so the selection runs through exactly the rows on screen (attention rows, groups, downloads).
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const rows = attention.data?.rows ?? []
  const shown = shownRows(rows, all)
  const downloads = queue.data ?? []
  const items = firstFive(downloads)
  const wanted = wantedVersions(titles.data ?? [])
  const wantedShown = wanted.slice(0, WANTED_SHOWN)
  const groups: Group[] = []
  if (adoption && planWaiting(adoption.state)) groups.push('adoption')
  if (attention.data?.long_missing && attention.data.long_missing.count > 0) groups.push('long-missing')
  if (attention.data?.originals && attention.data.originals.count > 0) groups.push('originals')
  const toggle = (g: Group) => setExpanded((e) => ({ ...e, [g]: !e[g] }))
  const enter: (() => void)[] = [
    ...shown.map((r) => () => {
      const open = r.actions.find((a) => a.method === 'GET')
      if (open) onOpen(open.path)
    }),
    ...groups.map((g) => () => (g === 'adoption' ? onOpenAdoption() : toggle(g))),
    // The left card, top to bottom, then the right: the running search pass (Enter opens the Title it is searching), then the Wanted rows.
    ...items.map((i) => () => i.title_id != null && onOpenTitle(i.title_id)),
    ...(search ? [() => search.current && onOpenTitle(search.current.title_id)] : finished.pass ? [() => {}] : []),
    ...wantedShown.map((w) => () => onOpenTitle(w.titleId)),
  ]
  return {
    attention,
    queue,
    adoption,
    all,
    setAll,
    expanded,
    toggle,
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
    wantedLoaded: !titles.isPending,
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
  const { attention, adoption, all, setAll, expanded, toggle, rows, shown, downloads, items, groups, search, finished, loaded } = model
  const groupBase = nav.base + shown.length
  const downloadBase = groupBase + groups.length
  const searchBase = downloadBase + items.length
  return (
    <div className="flex flex-col gap-4">
      {loaded && (shown.length > 0 || groups.length > 0) && (
        <Section id="needs-attention" title="Needs attention" count={rows.length}>
          <RowList>
            {shown.map((r, i) => (
              <Row key={r.id} row={r} onOpen={onOpen} nav={nav} index={nav.base + i} />
            ))}
            {groups.map((g, i) => {
              const index = groupBase + i
              if (g === 'adoption' && adoption) return <AdoptionPlanRow key={g} adoption={adoption} onOpen={onOpenAdoption} nav={nav} index={index} />
              if (g === 'long-missing' && attention.data?.long_missing)
                return <LongMissingRow key={g} group={attention.data.long_missing} open={!!expanded[g]} onToggle={() => toggle(g)} onOpen={onOpen} nav={nav} index={index} />
              if (g === 'originals' && attention.data?.originals)
                return <OriginalsGroupRow key={g} group={attention.data.originals} open={!!expanded[g]} onToggle={() => toggle(g)} onOpenTitle={onOpenTitle} nav={nav} index={index} />
              return null
            })}
          </RowList>
          {(all || shown.length < rows.length) && <ViewAllHere count={rows.length} open={all} onToggle={() => setAll(!all)} />}
        </Section>
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

/** A group's row: an icon, a message, a short label and its buttons, in the look of an attention row. */
function GroupRow({
  index,
  nav,
  icon,
  message,
  label,
  labelVariant = 'gray',
  actions,
  ...data
}: {
  index: number
  nav: OverviewNav
  icon: 'clock' | 'languages' | 'clipboard-list'
  message: string
  label: string
  labelVariant?: 'gray' | 'amber'
  actions: ReactNode
  [k: `data-${string}`]: boolean
}) {
  return (
    <Entity
      as="button"
      current={index === nav.sel}
      data-nav={`ov-${index}`}
      {...data}
      onClick={() => nav.select(index)}
      className={stackedRow}
      rightClassName={stackedRight}
      left={<Icon name={icon} />}
      right={actions}
    >
      <Entity.Content
        fill
        title={<span className="whitespace-normal">{message}</span>}
        description={
          <Badge variant={labelVariant} contrast="low" size="sm">
            {label}
          </Badge>
        }
      />
    </Entity>
  )
}

function ExpandButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <Button variant="tertiary" size="small" aria-label={label} aria-expanded={open} onClick={onToggle}>
      {open ? 'Hide' : 'Show'}
    </Button>
  )
}

const adoptionMessage = (a: Adoption) =>
  a.state === 'scanning'
    ? 'An Adoption scan is running'
    : a.state === 'committing'
      ? 'An Adoption plan is being committed'
      : `An Adoption plan is waiting for review${a.summary.needs_choice > 0 ? ` (${a.summary.needs_choice} need a choice)` : ''}`

/** A stored Adoption plan, as one row outside the rail badge: a new scan replaces it, so this points back to it. */
function AdoptionPlanRow({ adoption, onOpen, nav, index }: { adoption: Adoption; onOpen: () => void; nav: OverviewNav; index: number }) {
  return (
    <GroupRow
      data-adoption-plan
      index={index}
      nav={nav}
      icon="clipboard-list"
      message={adoptionMessage(adoption)}
      label="Adoption"
      labelVariant="amber"
      actions={
        <Button variant="secondary" size="small" onClick={onOpen}>
          Review the Adoption plan
        </Button>
      }
    />
  )
}

const dateOf = (iso: string) => iso.slice(0, 10)

/**
 * Versions Wanted for over 90 days, as one row that comes after the attention rows and is not in the rail
 * badge. It expands to the five most recently Wanted and links to the Library on its Long Missing filter.
 */
function LongMissingRow({
  group,
  open,
  onToggle,
  onOpen,
  nav,
  index,
}: {
  group: Attention['long_missing']
  open: boolean
  onToggle: () => void
  onOpen: (path: string) => void
  nav: OverviewNav
  index: number
}) {
  const names = useProfileNames()
  const title = `${group.count} ${group.count === 1 ? 'Version' : 'Versions'} long missing`
  return (
    <>
      <GroupRow
        data-long-missing
        index={index}
        nav={nav}
        icon="clock"
        message={title}
        label="Waiting"
        actions={
          <>
            <Button variant="secondary" size="small" onClick={() => onOpen(placePath('library', 'is:long_missing sort:wanted_since'))}>
              Open in Library
            </Button>
            <ExpandButton label={title} open={open} onToggle={onToggle} />
          </>
        }
      />
      {open &&
        group.items.map((i) => (
          <Entity key={i.version_id} left={<TitlePoster id={i.title_id} hasPoster={i.has_poster ?? false} size="sm" />}>
            <div className="flex min-w-0 flex-col">
              <span>
                {i.title} · {slotProfile(i.slot, profileName(names, i.profile))}
              </span>
              <span className="label-12 text-gray-900">
                Wanted since {dateOf(i.wanted_since)}
                {i.last_failure ? `, last failure: ${i.last_failure.replaceAll('_', ' ')}` : ''}
              </span>
            </div>
          </Entity>
        ))}
    </>
  )
}

/** Like Long Missing, one grouped row outside the rail badge; it expands to one row per Version, best Release first. */
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
      <GroupRow data-originals index={index} nav={nav} icon="languages" message={title} label="Offer" actions={<ExpandButton label={title} open={open} onToggle={onToggle} />} />
      {open && <Offers group={group} onOpenTitle={onOpenTitle} />}
    </>
  )
}

function Row({ row, onOpen, nav, index }: { row: AttentionRow; onOpen: (path: string) => void; nav: OverviewNav; index: number }) {
  const { act, pending, error, result, dialog } = useAttentionAction(onOpen)

  const [first, ...rest] = row.actions
  const actions = first && (
    <>
      <Button variant="secondary" size="small" disabled={pending} onClick={() => act(first)}>
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
      <Entity
        as="button"
        current={index === nav.sel}
        data-nav={`ov-${index}`}
        onClick={() => nav.select(index)}
        className={stackedRow}
        rightClassName={stackedRight}
        left={
          row.subject.title_id !== null ? (
            <TitlePoster id={row.subject.title_id} hasPoster={row.has_poster ?? false} size="sm" />
          ) : (
            <Icon name={row.severity === 'blocking' ? 'octagon-alert' : 'triangle-alert'} />
          )
        }
        right={actions}
      >
        <Entity.Content
          fill
          title={<span className="whitespace-normal">{row.message}</span>}
          description={
            <span className="flex flex-col gap-1">
              <span>
                <Badge variant={row.severity === 'blocking' ? 'red' : 'amber'} contrast="low" size="sm">
                  {row.severity === 'blocking' ? 'Blocking' : 'Warning'}
                </Badge>
              </span>
              {error && <Note variant="error">{error.message}</Note>}
              {result && <Result {...result} />}
            </span>
          }
        />
      </Entity>
      {dialog}
    </>
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
