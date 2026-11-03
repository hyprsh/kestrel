// Activity's In progress section: the search pass as one compact row, then one row per live Grab (downloading, stalled, …)
// with its state and a slim Progress bar. The × cancels at once; blocklisting stays in the ⋯ menu, because it changes
// what future searches grab. Both show on hover or focus, and on a phone a tap on the row opens them.
// chrome: domain-visual
import { Button, DestructiveActionModal, DotsMenu, Entity, EntityContent, MenuItem, Progress } from '@hyprsh/design'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { useDownloadClient, useStalledImport, type GrabEntry } from '../api/activity'
import type { QueueItem } from '../api/queue'
import type { SearchStatus } from '../api/search'
import { percent, plural } from '../format'
import { useCancel } from '../grabs/useCancel'
import { phases } from '../grabs/phase'
import type { RowNav } from '../keys'
import { TitlePoster } from '../poster'
import { usePhone } from '../responsive'
import { useReport } from '../toasts'
import { span, useNow } from '../time'
import { cx } from '../ui'
import { passLines, gapWaitLine, whereOf } from './SearchProgress'
import { SlotTag } from '../library/SlotChip'
import { speed, stuckText, whatOf } from './words'

type Pass = NonNullable<SearchStatus['pass']>

/** The part of a live row that says where the Grab is: its state words, tone and Progress bar. */
type Gist = { text: string; tone: 'blue' | 'amber' | 'red'; pct: number | null }

function activeGist(i: QueueItem, now: number): Gist {
  const pct = i.phase === 'importing' ? 100 : percent(i.bytes_total, i.bytes_left)
  if (i.stuck) return { text: stuckText(i.stuck, now), tone: 'amber', pct }
  if (i.phase === 'importing') return { text: i.checking_files ? `Importing · checking ${plural(i.checking_files, 'file')}` : 'Importing', tone: 'amber', pct }
  if (i.phase === 'paused') return { text: 'Paused', tone: 'amber', pct }
  const parts: (string | null)[] = [phases[i.phase].label]
  if (i.phase === 'downloading') {
    const rate = speed(i)
    parts.push(pct !== null ? `${pct}%` : null, i.eta != null ? span(i.eta * 1000) : null, rate)
  }
  return { text: parts.filter(Boolean).join(' · '), tone: 'blue', pct }
}

const tones = { blue: 'text-blue-900', amber: 'text-amber-900', red: 'text-red-900' } as const
const bars = { blue: 'success', amber: 'warning', red: 'error' } as const

/** The search pass's bar and its count. */
function PassBar({ phase }: { phase: { done: number; total: number } }) {
  return (
    <div className="flex items-center gap-2.5 max-sm:w-full sm:w-60">
      <Progress value={phase.done} max={Math.max(phase.total, 1)} type="success" height={6} aria-label="Search progress" className="min-w-16 flex-1" />
      <span className="label-12 w-16 shrink-0 text-right tabular-nums">{`${phase.done} of ${phase.total}`}</span>
    </div>
  )
}

/** The search pass as the first row of the card. */
export function SearchPassRow({ pass: p, indexers = [] }: { pass: Pass; indexers?: SearchStatus['indexers'] }) {
  const now = useNow(1_000)
  const phone = usePhone()
  const { phase, name, releases } = passLines(p, now)
  const waiting = gapWaitLine(indexers, now)
  const c = p.current
  const where = c ? [whereOf(c), c.slot].filter(Boolean).join(' · ') : null
  const bar = <PassBar phase={phase} />
  return (
    <Entity aria-label="Search pass" left={<Search aria-hidden className="size-5 text-gray-900" />} right={phone ? undefined : bar}>
      <EntityContent
        fill
        title={
          <>
            {name}
            {c && <span className="font-normal text-gray-900">{` · now ${c.title}${where ? ` ${where}` : ''}`}</span>}
          </>
        }
        description={<span className="label-12">{releases}</span>}
      >
        {waiting && <span className="label-12 text-amber-900">{waiting}</span>}
        {phone && bar}
      </EntityContent>
    </Entity>
  )
}

/** The state column of a live row: the Slot and its state words, then the Progress bar. */
function State({ grab: g, gist }: { grab: Pick<QueueItem, 'slot' | 'release_name'>; gist: Gist }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:w-60">
      <span className="flex min-w-0 items-center gap-2">
        {g.slot && <SlotTag slot={g.slot} state="downloading" text={gist.pct !== null ? `${gist.pct}%` : undefined} />}
        <span className={cx('label-12 truncate', tones[gist.tone])}>{gist.text}</span>
      </span>
      {gist.pct !== null && <Progress value={gist.pct} type={bars[gist.tone]} height={6} aria-label={`${g.release_name} progress`} />}
    </div>
  )
}

/**
 * A live row: poster, Title with what it covers, the Release and the state. On a wide screen the actions sit at the end, shown
 * on hover or focus. On a phone the row is the Entity's disclosure row and the actions are its detail, because the design's
 * expandable row holds no controls of its own.
 */
function LiveRow({
  grab: g,
  gist,
  nav,
  actions,
  more,
  below,
}: {
  grab: Pick<QueueItem, 'title_id' | 'has_poster' | 'title' | 'episodes' | 'slot' | 'release_name'>
  gist: Gist
  nav: RowNav
  actions: React.ReactNode
  more: React.ReactNode
  below?: React.ReactNode
}) {
  const phone = usePhone()
  const name = g.title || 'Deleted Title'
  const state = <State grab={g} gist={gist} />
  return (
    <Entity
      className="group"
      current={nav.index === nav.sel}
      data-nav={`${nav.scope}-${nav.index}`}
      left={g.title_id != null ? <TitlePoster id={g.title_id} hasPoster={g.has_poster} size="xs" /> : <span className="w-7" />}
      right={
        phone ? undefined : (
          <>
            {state}
            <span className="flex w-16 justify-end gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {actions}
              {more}
            </span>
          </>
        )
      }
      detail={phone ? <div className="flex flex-wrap gap-2">{below}</div> : undefined}
      onClick={phone ? nav.onSelect : undefined}
      onClickCapture={phone ? undefined : nav.onSelect}
    >
      <EntityContent
        fill
        title={
          <>
            {name} <span className="font-normal text-gray-900">{whatOf(g)}</span>
          </>
        }
        description={<span className="label-12-mono">{g.release_name}</span>}
      >
        {phone && state}
      </EntityContent>
    </Entity>
  )
}

const cross = (label: string, onClick: () => void, disabled: boolean) => (
  <Button variant="tertiary" size="tiny" svgOnly aria-label={label} disabled={disabled} onClick={onClick}>
    <X aria-hidden className="size-4" />
  </Button>
)

/** A queued, downloading, post-processing or importing Grab. */
export function ActiveRow({ item: i, nav, onOpenTitle }: { item: QueueItem; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const now = useNow()
  const cancel = useCancel()
  const client = useDownloadClient()
  const gist = activeGist(i, now)
  const name = i.title || 'Deleted Title'
  const run = (blocklist: boolean) => void cancel.run(i.grab_id, blocklist)
  return (
    <LiveRow
      grab={i}
      gist={gist}
      nav={nav}
      actions={cross(`Cancel ${name}`, () => run(false), cancel.pending)}
      more={
        <DotsMenu size="tiny" aria-label={`More for ${name}`} width={220}>
          <MenuItem disabled={cancel.pending} onSelect={() => run(false)}>
            Cancel
          </MenuItem>
          <MenuItem disabled={cancel.pending} onSelect={() => run(true)}>
            Cancel and Blocklist
          </MenuItem>
          {client?.url && <MenuItem onSelect={() => window.open(client.url!, '_blank', 'noopener')}>{`Open in ${client.name}`}</MenuItem>}
          {i.title_id != null && <MenuItem onSelect={() => onOpenTitle(i.title_id!)}>{`Open ${name}`}</MenuItem>}
        </DotsMenu>
      }
      below={
        <>
          <Button variant="secondary" size="small" disabled={cancel.pending} onClick={() => run(false)}>
            Cancel
          </Button>
          <Button variant="secondary" size="small" disabled={cancel.pending} onClick={() => run(true)}>
            Cancel and Blocklist
          </Button>
          {i.title_id != null && <Button variant="tertiary" size="small" onClick={() => onOpenTitle(i.title_id!)}>{`Open ${name}`}</Button>}
        </>
      }
    />
  )
}

/** An Import that waits for the environment to be fixed: Retry now, or Discard after asking. */
export function StalledRow({ grab: g, nav, onOpenTitle }: { grab: GrabEntry; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const act = useStalledImport()
  const report = useReport()
  const [asking, setAsking] = useState(false)
  const name = g.title || 'Deleted Title'
  const retry = () => void report(act.mutateAsync({ id: g.grab_id, action: 'retry' }), { done: 'Import retried', failed: 'Could not retry the import' })
  const gist: Gist = { text: `Stalled · ${g.stalled!.reason}`, tone: 'red', pct: 100 }
  return (
    <>
      <LiveRow
        grab={g}
        gist={gist}
        nav={nav}
        actions={cross(`Discard ${name}`, () => setAsking(true), act.isPending)}
        more={
          <DotsMenu size="tiny" aria-label={`More for ${name}`} width={220}>
            <MenuItem disabled={act.isPending} onSelect={retry}>
              Retry now
            </MenuItem>
            <MenuItem disabled={act.isPending} onSelect={() => setAsking(true)}>
              Discard
            </MenuItem>
            {g.title_id != null && <MenuItem onSelect={() => onOpenTitle(g.title_id!)}>{`Open ${name}`}</MenuItem>}
          </DotsMenu>
        }
        below={
          <>
            <Button variant="secondary" size="small" disabled={act.isPending} onClick={retry}>
              Retry now
            </Button>
            <Button variant="secondary" size="small" disabled={act.isPending} onClick={() => setAsking(true)}>
              Discard
            </Button>
          </>
        }
      />
      <DestructiveActionModal
        open={asking}
        title="Discard this Grab"
        confirmLabel="Discard"
        description="Its downloaded files are deleted and the Version is searched for again."
        loading={act.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          void report(act.mutateAsync({ id: g.grab_id, action: 'discard' }), { done: 'Grab discarded', failed: 'Could not discard the Grab' })
        }}
      />
    </>
  )
}
