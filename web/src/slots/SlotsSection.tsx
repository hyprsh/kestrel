import { Button, DotsMenu, MenuItem, Note, Toggle } from '@hyprsh/design'
import { GripVertical } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { ApiError, useProfiles, useTitles, type Profile } from '../api/queries'
import { declaresSlots, useDeleteSlot, usePatchSlot, useSlots, type Slot } from '../api/slots'
import { plural } from '../format'
import { SlotHead, SlotLine } from '../layout/SettingsLists'
import { SettingsCard, SettingsSection } from '../layout/SettingsPage'
import { SkeletonRows } from '../loading'
import { DeleteSlot } from './DeleteSlot'
import { SlotForm } from './SlotForm'
import { SlotWarnings } from './SlotWarnings'

const MAX_SLOTS = 4

const problemText = (e: unknown) => (e instanceof ApiError && (e.status === 422 || e.status === 409) ? e.message : 'Could not save. Try again.')

/** The Slot's default Profile per kind, always both: "Movies HD, Series HD", "Movies HD, Series none". */
function defaultsText(slot: Slot, profiles: Profile[]) {
  const name = (key: string | null) => (key ? (profiles.find((p) => p.key === key)?.name ?? key) : 'none')
  const movies = name(slot.default_movies)
  const series = name(slot.default_series)
  return `Movies ${movies}, Series ${series}`
}

/**
 * Settings, Library, Slots (ADR 0024): the Slots in order, each with its default Profile for Movies and Series, its "on for
 * new Titles" switch and the Versions it holds. A row's drag handle (or the arrow keys on it) changes the order. Add and
 * Edit open a form; Delete asks first, and can delete the Slot's Versions with it. While the Config File declares `slots`
 * the list is read-only.
 */
export function SlotsSection() {
  const slots = useSlots()
  const profiles = useProfiles()
  const titles = useTitles()
  const patch = usePatchSlot()
  const remove = useDeleteSlot()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  if (slots.isError || profiles.isError)
    return (
      <SettingsSection title="Slots">
        <Note variant="error" size="small">
          Could not load the Slots.
        </Note>
      </SettingsSection>
    )
  if (!slots.data || !profiles.data)
    return (
      <SettingsSection title="Slots">
        <SkeletonRows count={2} />
      </SettingsSection>
    )

  const saved = slots.data
  const rows = order ? [...saved].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : saved
  const declared = declaresSlots(saved)
  const onCount = saved.filter((s) => s.on_for_new_titles).length
  const held = (id: string) => titles.data?.filter((t) => t.slot_states.some((s) => s.slot === id)).length
  const editingSlot = editing && editing !== 'new' ? saved.find((s) => s.id === editing) : undefined
  const deletingSlot = deleting ? saved.find((s) => s.id === deleting) : undefined

  const move = (from: number, to: number) => {
    if (declared || to < 0 || to >= rows.length || from === to) return
    const ids = rows.map((r) => r.id)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setOrder(ids)
    patch.mutate({ id: rows[from].id, patch: { position: to } }, { onSettled: () => setOrder(null) })
  }
  const onHandleKey = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp') move(index, index - 1)
    else if (e.key === 'ArrowDown') move(index, index + 1)
    else return
    e.preventDefault()
  }
  const deleteReason = (s: Slot) => {
    if (declared) return 'The Config File declares it'
    if (saved.length === 1) return 'A library needs at least one Slot'
    if (s.on_for_new_titles && onCount === 1) return 'At least one Slot must be on for new Titles'
    return undefined
  }

  return (
    <SettingsSection
      title="Slots"
      count={rows.length}
      action={
        rows.length < MAX_SLOTS && (
          <Button size="small" disabled={declared} onClick={() => setEditing('new')}>
            Add Slot…
          </Button>
        )
      }
    >
      <SlotWarnings />
      <SettingsCard>
        <SlotHead />
        {rows.map((s, index) => {
          const n = held(s.id)
          const lastOn = s.on_for_new_titles && onCount === 1
          const reason = deleteReason(s)
          return (
            <div key={s.id} role="group" aria-label={s.label}>
              <SlotLine
                dragging={dragging === s.id}
                draggable={!declared}
                onDragStart={(e) => {
                  setDragging(s.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', s.id)
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging !== null && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragging !== null)
                    move(
                      rows.findIndex((r) => r.id === dragging),
                      index,
                    )
                  setDragging(null)
                }}
                handle={
                  <Button
                    svgOnly
                    variant="tertiary"
                    size="tiny"
                    disabled={declared}
                    aria-label={`Change the order of ${s.label}`}
                    title={declared ? 'The Config File sets the order' : 'Drag to change the order, or press the up and down arrow keys'}
                    onKeyDown={(e) => onHandleKey(e, index)}
                  >
                    <GripVertical />
                  </Button>
                }
                label={s.label}
                defaults={defaultsText(s, profiles.data)}
                holds={n === undefined ? '' : plural(n, 'Version')}
                toggle={
                  <Toggle
                    aria-label={`${s.label} on for new Titles`}
                    title={lastOn ? 'At least one Slot must be on for new Titles' : undefined}
                    checked={s.on_for_new_titles}
                    disabled={declared || lastOn || patch.isPending}
                    onChange={(on) => patch.mutate({ id: s.id, patch: { on_for_new_titles: on } })}
                  />
                }
                menu={
                  <DotsMenu aria-label={`${s.label} actions`} size="tiny">
                    <MenuItem disabled={declared} description={declared ? 'The Config File declares it' : undefined} onClick={() => setEditing(s.id)}>
                      Edit…
                    </MenuItem>
                    <MenuItem type="error" disabled={reason !== undefined} description={reason} onClick={() => setDeleting(s.id)}>
                      Delete…
                    </MenuItem>
                  </DotsMenu>
                }
              />
            </div>
          )
        })}
      </SettingsCard>
      {patch.isError && (
        <Note variant="error" size="small">
          {problemText(patch.error)}
        </Note>
      )}
      <span className="label-12 text-gray-900">
        {declared
          ? 'The Config File sets the Slots, so they cannot be changed here. Change the file and restart Kestrel instead.'
          : 'A Slot is a copy of a Title: its label names the files. Drag to change the order.'}
      </span>
      {editing === 'new' && <SlotForm profiles={profiles.data} titles={titles.data ?? []} onClose={() => setEditing(null)} />}
      {editingSlot && <SlotForm key={editingSlot.id} slot={editingSlot} profiles={profiles.data} titles={titles.data ?? []} onClose={() => setEditing(null)} />}
      {deletingSlot && <DeleteSlot slot={deletingSlot} titles={titles.data ?? []} remove={remove} onClose={() => setDeleting(null)} />}
    </SettingsSection>
  )
}
