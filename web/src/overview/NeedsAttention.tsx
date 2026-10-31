// Needs attention: the rows the server raised, with the actions it built. Nothing
// here knows a kind of row; it draws message, severity and buttons.
import { Badge, Button, Collapse, DotsMenu, Entity, Icon, MenuItem, Note } from '@hyprsh/design'
import { RowList, stackedRow, stackedRight } from '../layout/RowList'
import { useState } from 'react'
import { useAttention, type ActionResult, type Attention, type AttentionRow } from '../api/attention'
import { SkeletonRows } from '../loading'
import { planWaiting, useAdoption, type Adoption } from '../api/adoption'
import { profileName, slotProfile, useProfileNames } from '../library/slotProfile'
import { placePath } from '../place'
import { TitlePoster } from '../poster'
import { useAttentionAction } from './useAttentionAction'
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
  onOpenAdoption,
  nav,
  all,
  onAll,
}: {
  onOpen: (path: string) => void
  onOpenTitle: (id: number) => void
  onOpenAdoption: () => void
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
  const adoption = useAdoption().data
  const nothing = rows.length === 0 && !(originals && originals.count > 0) && !planWaiting(adoption?.state)
  return (
    <Section id="needs-attention" title="Needs attention" count={rows.length}>
      {attention.isPending ? (
        <SkeletonRows poster="sm" />
      ) : attention.data && nothing ? (
        <EmptyLine title="Nothing needs attention." />
      ) : (
        rows.length > 0 && (
          <RowList>
            {shown.map((r, i) => (
              <Row key={r.id} row={r} onOpen={onOpen} nav={nav} index={nav.base + i} />
            ))}
          </RowList>
        )
      )}
      {(all || shown.length < rows.length) && <ViewAllHere count={rows.length} open={all} onToggle={() => onAll(!all)} />}
      {adoption && planWaiting(adoption.state) && <AdoptionPlanRow adoption={adoption} onOpen={onOpenAdoption} />}
      {longMissing && longMissing.count > 0 && <LongMissingRow group={longMissing} onOpen={onOpen} />}
      {originals && originals.count > 0 && <OriginalsRow group={originals} onOpenTitle={onOpenTitle} />}
    </Section>
  )
}

const adoptionMessage = (a: Adoption) =>
  a.state === 'scanning'
    ? 'An Adoption scan is running'
    : a.state === 'committing'
      ? 'An Adoption plan is being committed'
      : `An Adoption plan is waiting for review${a.summary.needs_choice > 0 ? ` (${a.summary.needs_choice} need a choice)` : ''}`

/** A stored Adoption plan, as one row outside the rail badge: a new scan replaces it, so this points back to it. */
function AdoptionPlanRow({ adoption, onOpen }: { adoption: Adoption; onOpen: () => void }) {
  return (
    <div className="mt-3">
      <Note
        data-adoption-plan
        variant="warning"
        label="Adoption"
        action={
          <Button variant="secondary" size="small" onClick={onOpen}>
            Review the Adoption plan
          </Button>
        }
      >
        {adoptionMessage(adoption)}
      </Note>
    </div>
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
  const names = useProfileNames()
  return (
    <div data-long-missing className="mt-3">
      <Collapse size="small" headingLevel={4} expanded={open} onChange={setOpen} title={`${group.count} ${group.count === 1 ? 'Version' : 'Versions'} long missing`}>
        {open && (
          <div className="flex flex-col gap-3">
            <Entity.List>
              {group.items.map((i) => (
                <Entity key={i.version_id} left={<TitlePoster id={i.title_id} hasPoster={i.has_poster ?? false} size="md" />}>
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
            </Entity.List>
            <div>
              <Button variant="secondary" size="small" onClick={() => onOpen(placePath('library', 'is:long_missing sort:wanted_since'))}>
                Open in Library
              </Button>
            </div>
          </div>
        )}
      </Collapse>
    </div>
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
          title={row.message}
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
