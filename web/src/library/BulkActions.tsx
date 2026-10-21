import { useState } from 'react'
import { useBulkTitles, type TitleBulkOutcome, type TitleBulkReason, type TitlesBulk } from '../api/bulk'
import { useProfiles, type Profile, type TitleRow } from '../api/queries'
import { plural } from '../format'
import { Button, ErrorText, Select } from '../forms'
import { size, slotKeys, slotLabel, type SlotKey } from './bits'
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

type Result = { label: string; items: TitleBulkOutcome[]; slot: string | null }
type Form = 'monitor' | 'switch_profile' | 'add_version' | 'remove_version' | 'remove'

/** The right pane while Titles are checked: the actions for all of them at once and what the last one did. */
export function BulkActions({ rows }: { rows: TitleRow[] }) {
  const bulk = useBulkTitles()
  const profiles = (useProfiles().data ?? []).filter((p) => p.enabled)
  const [result, setResult] = useState<Result | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const ids = rows.map((r) => r.id)
  const hasSeries = rows.some((r) => r.kind === 'series')
  const onlySeries = rows.every((r) => r.kind === 'series')

  const run = (label: string, body: TitlesBulk, slot: SlotKey | null = null) =>
    bulk.mutate(body, {
      onSuccess: (items) => {
        setResult({ label, items, slot: slot && slotLabel[slot] })
        setForm(null)
      },
    })
  const action = (label: string, onClick: () => void) => (
    <Button variant="secondary" className="h-7" disabled={bulk.isPending} onClick={onClick}>
      {label}
    </Button>
  )
  const close = () => setForm(null)
  const busy = bulk.isPending

  const name = `${plural(rows.length, 'Title')} ticked`
  return (
    <section aria-label={name} className="min-w-0 flex-1 overflow-auto p-6">
      <h2 className="text-[15px] font-semibold tracking-tight">{name}</h2>
      <div role="toolbar" aria-label="Change the ticked Titles" className="mt-4 flex flex-wrap gap-2">
        {action('Monitor', () => (hasSeries ? setForm('monitor') : run('Monitor', { action: 'monitor', monitored: true, title_ids: ids })))}
        {action('Unmonitor', () => run('Unmonitor', { action: 'monitor', monitored: false, title_ids: ids }))}
        {action('Switch Profile', () => setForm('switch_profile'))}
        {action('Add Version', () => setForm('add_version'))}
        {action('Remove Version', () => setForm('remove_version'))}
        {action('Search now', () => run('Search now', { action: 'search', title_ids: ids }))}
        {action('Refresh metadata', () => run('Refresh metadata', { action: 'refresh', title_ids: ids }))}
        {action('Freeze metadata', () => run('Freeze metadata', { action: 'freeze', frozen: true, title_ids: ids }))}
        {action('Unfreeze metadata', () => run('Unfreeze metadata', { action: 'freeze', frozen: false, title_ids: ids }))}
        {action('Remove from Library', () => setForm('remove'))}
      </div>

      {form === 'monitor' && (
        <MonitorForm busy={busy} onCancel={close} onApply={(mode) => run('Monitor', { action: 'monitor', monitored: true, series_monitor: mode, title_ids: ids })} />
      )}
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
          initial={(slot) => profiles.find((p) => p.slot === slot && (onlySeries ? p.default_series : p.default_movies))?.key}
          busy={busy}
          onCancel={close}
          onApply={(slot, profile) => run('Add Version', { action: 'add_version', slot, profile, title_ids: ids }, slot)}
        />
      )}
      {form === 'remove_version' && <RemoveVersionForm busy={busy} onCancel={close} onApply={(slot, d) => run('Remove Version', { action: 'remove_version', slot, delete_files: d, title_ids: ids }, slot)} />}
      {form === 'remove' && (
        <div className="max-w-xs">
          <RemoveConfirm what="Titles" busy={busy} onCancel={close} onConfirm={(d) => run('Remove from Library', { action: 'remove', delete_files: d, title_ids: ids })}>
            <p className="mb-2">
              Remove {plural(rows.length, 'Title')} from the Library, with {size(rows.reduce((n, r) => n + r.size, 0))} of files.
            </p>
          </RemoveConfirm>
        </div>
      )}

      {bulk.error && <ErrorText>{bulk.error.message}</ErrorText>}
      {result && <Summary result={result} />}
    </section>
  )
}

/** Apply and Cancel under an action's options. */
function FormButtons({ busy, onApply, onCancel }: { busy: boolean; onApply: () => void; onCancel: () => void }) {
  return (
    <div className="mt-2 flex gap-2">
      <Button className="h-7" disabled={busy} onClick={onApply}>
        Apply
      </Button>
      <Button variant="secondary" className="h-7" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/** The Series among the ticked Titles take a monitoring mode; Movies are simply monitored. */
function MonitorForm({ busy, onApply, onCancel }: { busy: boolean; onApply: (mode: 'all' | 'future') => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'all' | 'future'>('all')
  return (
    <div role="group" aria-label="Monitor" className="mt-3 max-w-xs">
      <label className="text-[12px] font-medium text-gray-900">
        Series monitor
        <Select className="mt-1" value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'future')}>
          <option value="all">All episodes</option>
          <option value="future">Future episodes</option>
        </Select>
      </label>
      <FormButtons busy={busy} onCancel={onCancel} onApply={() => onApply(mode)} />
    </div>
  )
}

function SlotSelect({ slot, onChange }: { slot: SlotKey; onChange: (slot: SlotKey) => void }) {
  return (
    <label className="text-[12px] font-medium text-gray-900">
      Slot
      <Select className="mt-1" value={slot} onChange={(e) => onChange(e.target.value as SlotKey)}>
        {slotKeys.map((k) => (
          <option key={k} value={k}>
            {slotLabel[k]}
          </option>
        ))}
      </Select>
    </label>
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
  initial?: (slot: SlotKey) => string | undefined
  busy: boolean
  onApply: (slot: SlotKey, profile: string) => void
  onCancel: () => void
}) {
  const [slot, setSlot] = useState<SlotKey>('standard')
  const [picked, setPicked] = useState<Partial<Record<SlotKey, string>>>({})
  const options = profiles.filter((p) => p.slot === slot)
  const want = picked[slot] ?? initial?.(slot)
  const profile = options.find((p) => p.key === want)?.key ?? options[0]?.key ?? ''
  return (
    <div role="group" aria-label={label} className="mt-3 flex max-w-xs flex-col gap-2">
      <SlotSelect slot={slot} onChange={setSlot} />
      <label className="text-[12px] font-medium text-gray-900">
        Profile
        <Select className="mt-1" value={profile} onChange={(e) => setPicked({ ...picked, [slot]: e.target.value })}>
          {options.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <FormButtons busy={busy || !profile} onCancel={onCancel} onApply={() => onApply(slot, profile)} />
    </div>
  )
}

function RemoveVersionForm({ busy, onApply, onCancel }: { busy: boolean; onApply: (slot: SlotKey, deleteFiles: boolean) => void; onCancel: () => void }) {
  const [slot, setSlot] = useState<SlotKey>('standard')
  return (
    <div className="max-w-xs">
      <RemoveConfirm what="Version" busy={busy} onCancel={onCancel} onConfirm={(d) => onApply(slot, d)}>
        <div className="mb-2">
          <SlotSelect slot={slot} onChange={setSlot} />
        </div>
      </RemoveConfirm>
    </div>
  )
}

function Summary({ result }: { result: Result }) {
  const { changed, others } = summarize(result.items, result.slot)
  return (
    <div role="status" className="mt-4 rounded-md border border-gray-alpha-400 p-3 text-[12px]">
      <div className="font-medium">
        {result.label}: {changed} changed
      </div>
      {others.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-gray-900">
          {others.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
