import { Fragment, useState, type ReactNode } from 'react'
import { useBulkTitles, type TitleBulkOutcome, type TitleBulkReason, type TitlesBulk } from '../api/bulk'
import { useProfiles, type Profile, type TitleRow } from '../api/queries'
import { plural } from '../format'
import { ActionBar, Button, DotsMenu, MenuDivider, MenuItem, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalTitle, Select } from '@hyprsh/design'
import { size } from './bits'
import { slotDefault, useSlotNames } from './slots'
import { useReport } from '../toasts'
import { RemoveConfirm } from './ManageVersion'

const has = (n: number) => (n === 1 ? 'has' : 'have')

/** One group of skipped or failed Titles in a sentence, such as "3 have no 4K Version". */
function phrase(outcome: TitleBulkOutcome['outcome'], reason: TitleBulkReason | null, message: string | null, n: number, slot: string | null): string {
  if (outcome === 'failed') return `${n} failed: ${message ?? reason ?? 'unknown'}`
  switch (reason) {
    case 'unchanged':
      return `${n} already as asked`
    case 'not_found':
      return `${n} no longer in the Library`
    case 'no_version':
      return `${n} ${has(n)} no ${slot} Version`
    case 'slot_taken':
      return `${n} already ${has(n)} a ${slot} Version`
    case 'profile_taken':
      return `${n} already ${has(n)} a Version under that Profile`
    case 'nothing_wanted':
      return `${n} ${has(n)} nothing Wanted`
    case 'frozen':
      return `${n} ${has(n)} frozen metadata`
  }
  return `${n} skipped: ${message ?? reason ?? 'unknown'}`
}

/** What a bulk call did: how many changed, then each reason Titles were skipped or failed. */
function summarize(items: TitleBulkOutcome[], slot: string | null): { changed: number; others: string[] } {
  const groups = new Map<string, { outcome: TitleBulkOutcome['outcome']; reason: TitleBulkReason | null; message: string | null; n: number }>()
  let changed = 0
  for (const it of items) {
    if (it.outcome === 'changed') {
      changed++
      continue
    }
    const key = `${it.outcome}/${it.reason}`
    const g = groups.get(key) ?? { outcome: it.outcome, reason: it.reason, message: it.message, n: 0 }
    g.n++
    groups.set(key, g)
  }
  return { changed, others: [...groups.values()].map((g) => phrase(g.outcome, g.reason, g.message, g.n, slot)) }
}

type Form = 'monitor' | 'switch_profile' | 'add_version' | 'remove_version' | 'remove'

/**
 * The ActionBar at the foot of the list while Titles are ticked: how many with its × (Escape clears too) and Select All,
 * then Search Now, Unmonitor (quiet, under the bar's More when narrow) and the rarer actions in a ⋯ menu (on a phone, in the bar's More). The Title pane
 * beside the list stays open. An action that needs a choice (a Slot, a Profile, a monitoring mode) or a confirmation asks
 * in a dialog.
 */
export function BulkActions({
  rows,
  shown,
  onSelectAll,
  onClear,
  compact = false,
}: {
  rows: TitleRow[]
  shown: number
  onSelectAll: () => void
  onClear: () => void
  /** A phone's bar: every action but Search Now sits in the bar's own More menu. */
  compact?: boolean
}) {
  const bulk = useBulkTitles()
  const slots = useSlotNames()
  const profiles = (useProfiles().data ?? []).filter((p) => p.enabled)
  const report = useReport()
  const [form, setForm] = useState<Form | null>(null)
  const ids = rows.map((r) => r.id)
  const hasSeries = rows.some((r) => r.kind === 'series')
  const onlySeries = rows.every((r) => r.kind === 'series')

  // The form closes on apply, and a Toast says what came of it: the dialog's result must outlive it.
  const run = (label: string, body: TitlesBulk, slot: string | null = null) => {
    setForm(null)
    void report(bulk.mutateAsync(body), {
      ...(body.action === 'search' ? { started: (items: TitleBulkOutcome[]) => summaryText('Search started', items, null, 'for') } : {}),
      done: (items) => summaryText(label, items, slot && slots.name(slot)),
      warn: (items) => summarize(items, null).others.length > 0,
      failed: `${label} failed`,
    })
  }
  const close = () => setForm(null)
  const busy = bulk.isPending

  const unmonitor = { label: 'Unmonitor', disabled: busy, onSelect: () => run('Unmonitor', { action: 'monitor', monitored: false, title_ids: ids }) }
  // The rarer actions, in groups the ⋯ menu divides; the last group is the one that destroys.
  const rarer: { label: string; onSelect: () => void; danger?: boolean }[][] = [
    [
      { label: hasSeries ? 'Monitor…' : 'Monitor', onSelect: () => (hasSeries ? setForm('monitor') : run('Monitor', { action: 'monitor', monitored: true, title_ids: ids })) },
      { label: 'Switch Profile…', onSelect: () => setForm('switch_profile') },
      { label: 'Add Version…', onSelect: () => setForm('add_version') },
      { label: 'Remove Version…', onSelect: () => setForm('remove_version') },
    ],
    [
      { label: 'Refresh Metadata', onSelect: () => run('Refresh metadata', { action: 'refresh', title_ids: ids }) },
      { label: 'Freeze Metadata', onSelect: () => run('Freeze metadata', { action: 'freeze', frozen: true, title_ids: ids }) },
      { label: 'Unfreeze Metadata', onSelect: () => run('Unfreeze metadata', { action: 'freeze', frozen: false, title_ids: ids }) },
    ],
    [{ label: 'Remove from Library…', onSelect: () => setForm('remove'), danger: true }],
  ]
  const search = (
    <Button variant="primary" size="small" disabled={busy} onClick={() => run('Search now', { action: 'search', title_ids: ids })}>
      Search Now
    </Button>
  )

  return (
    <>
      <ActionBar
        open
        selection={{ count: rows.length, total: shown, onSelectAll, onClear }}
        // A phone's bar has room for the count and Search Now: every other action sits in the bar's own More menu, so there is one ⋯, not two.
        secondaryActions={compact ? [unmonitor, ...rarer.flat().map((x) => ({ label: x.label, disabled: busy, onSelect: x.onSelect }))] : [unmonitor]}
        actions={
          compact ? (
            search
          ) : (
            <>
              {search}
              <DotsMenu aria-label="More actions for the ticked Titles" size="small" position="top-end" width={220} disabled={busy}>
                {rarer.map((group, i) => (
                  <Fragment key={i}>
                    {i > 0 && <MenuDivider />}
                    {group.map((x) => (
                      <MenuItem key={x.label} type={x.danger ? 'error' : undefined} onSelect={x.onSelect}>
                        {x.label}
                      </MenuItem>
                    ))}
                  </Fragment>
                ))}
              </DotsMenu>
            </>
          )
        }
      />

      {form === 'monitor' && <MonitorForm busy={busy} onCancel={close} onApply={(mode) => run('Monitor', { action: 'monitor', monitored: true, series_monitor: mode, title_ids: ids })} />}
      {form === 'switch_profile' && (
        <SlotForm
          label="Switch Profile"
          profiles={profiles}
          busy={busy}
          onCancel={close}
          onApply={(slot, profile) => run('Switch Profile', { action: 'switch_profile', slot, profile, title_ids: ids }, slot)}
        />
      )}
      {form === 'add_version' && (
        <SlotForm
          label="Add Version"
          profiles={profiles}
          initial={(slot) =>
            slotDefault(
              slots.list.find((r) => r.id === slot),
              onlySeries ? 'series' : 'movie',
            )
          }
          busy={busy}
          onCancel={close}
          onApply={(slot, profile) => run('Add Version', { action: 'add_version', slot, profile, title_ids: ids }, slot)}
        />
      )}
      {form === 'remove_version' && <RemoveVersionForm onCancel={close} onApply={(slot, d) => run('Remove Version', { action: 'remove_version', slot, delete_files: d, title_ids: ids }, slot)} />}
      {form === 'remove' && (
        <RemoveConfirm what="Titles" onCancel={close} onConfirm={(d) => run('Remove from Library', { action: 'remove', delete_files: d, title_ids: ids })}>
          Remove {plural(rows.length, 'Title')} from the Library, with {size(rows.reduce((n, r) => n + r.size, 0))} of files.
        </RemoveConfirm>
      )}
    </>
  )
}

/** A dialog asking for an action's options, with Apply and Cancel. */
function FormDialog({ label, busy, onApply, onCancel, children }: { label: string; busy: boolean; onApply: () => void; onCancel: () => void; children: ReactNode }) {
  return (
    <Modal open onClose={onCancel}>
      <ModalBody>
        <ModalHeader>
          <ModalTitle>{label}</ModalTitle>
        </ModalHeader>
        <div role="group" aria-label={label} className="flex flex-col gap-2">
          {children}
        </div>
      </ModalBody>
      <ModalActions>
        <ModalAction variant="secondary" onClick={onCancel}>
          Cancel
        </ModalAction>
        <ModalAction disabled={busy} onClick={onApply}>
          Apply
        </ModalAction>
      </ModalActions>
    </Modal>
  )
}

/** The Series among the ticked Titles take a monitoring mode; Movies are simply monitored. */
function MonitorForm({ busy, onApply, onCancel }: { busy: boolean; onApply: (mode: 'all' | 'future') => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'all' | 'future'>('all')
  return (
    <FormDialog label="Monitor" busy={busy} onCancel={onCancel} onApply={() => onApply(mode)}>
      <Select size="small" label="Series monitor" value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'future')}>
        <option value="all">All episodes</option>
        <option value="future">Future episodes</option>
      </Select>
    </FormDialog>
  )
}

/** The Slot to act on: the first Slot until another is picked. */
function useSlotChoice() {
  const slots = useSlotNames()
  const [picked, setPicked] = useState<string | null>(null)
  return { slot: picked ?? slots.list[0]?.id ?? '', setSlot: setPicked }
}

/** The pick of a Slot; a library with one Slot has none to pick. */
function SlotSelect({ slot, onChange }: { slot: string; onChange: (slot: string) => void }) {
  const slots = useSlotNames()
  if (!slots.several) return null
  return (
    <Select size="small" label="Slot" value={slot} onChange={(e) => onChange(e.target.value)}>
      {slots.list.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </Select>
  )
}

/** A Slot and one of its enabled Profiles, starting on `initial` for that Slot when it names one. */
function SlotForm({
  label,
  profiles,
  initial,
  busy,
  onApply,
  onCancel,
}: {
  label: string
  profiles: Profile[]
  initial?: (slot: string) => string | undefined
  busy: boolean
  onApply: (slot: string, profile: string) => void
  onCancel: () => void
}) {
  const { slot, setSlot } = useSlotChoice()
  const [picked, setPicked] = useState<Partial<Record<string, string>>>({})
  const options = profiles // any Profile can fill any Slot
  const want = picked[slot] ?? initial?.(slot)
  const profile = options.find((p) => p.key === want)?.key ?? options[0]?.key ?? ''
  return (
    <FormDialog label={label} busy={busy || !profile} onCancel={onCancel} onApply={() => onApply(slot, profile)}>
      <SlotSelect slot={slot} onChange={setSlot} />
      <Select size="small" label="Profile" value={profile} onChange={(e) => setPicked({ ...picked, [slot]: e.target.value })}>
        {options.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </Select>
    </FormDialog>
  )
}

function RemoveVersionForm({ onApply, onCancel }: { onApply: (slot: string, deleteFiles: boolean) => void; onCancel: () => void }) {
  const { slot, setSlot } = useSlotChoice()
  return (
    <RemoveConfirm what="Version" onCancel={onCancel} onConfirm={(d) => onApply(slot, d)}>
      <SlotSelect slot={slot} onChange={setSlot} />
    </RemoveConfirm>
  )
}

/** What a bulk call did in a sentence for its Toast: "Unmonitor: 3 changed; 1 already as asked". */
function summaryText(label: string, items: TitleBulkOutcome[], slot: string | null, join: 'for' | ':' = ':'): string {
  const { changed, others } = summarize(items, slot)
  return [join === 'for' ? `${label} for ${plural(changed, 'Title')}` : `${label}: ${changed} changed`, ...others].join('; ')
}
