import { Button, DotsMenu, Entity, MenuItem, Note, Toggle } from '@hyprsh/design'
import { useState } from 'react'
import { ApiError, useProfiles, useTitles, type Profile } from '../api/queries'
import { declaresSlots, useDeleteSlot, usePatchSlot, useSlots, type Slot } from '../api/slots'
import { plural } from '../format'
import { SettingsSection } from '../layout/SettingsPage'
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
 * Settings, Slots & Profiles, Slots (ADR 0024): the Slots in order, each with its default Profile for Movies and Series, its "on for
 * new Titles" switch and the Versions it holds. A row's drag handle (or Alt and the arrow keys on it, or its menu) changes the order. Add and
 * Edit open a form; Delete asks first, and can delete the Slot's Versions with it. While the Config File declares `slots`
 * the list is read-only. `embedded` leaves out the section's own heading, for the setup wizard's Slots step, which names it.
 */
export function SlotsSection({ embedded = false }: { embedded?: boolean }) {
  const slots = useSlots()
  const profiles = useProfiles()
  const titles = useTitles()
  const patch = usePatchSlot()
  const remove = useDeleteSlot()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)

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
  const full = rows.length >= MAX_SLOTS
  const deleteReason = (s: Slot) => {
    if (declared) return 'The Config File declares it'
    if (saved.length === 1) return 'A library needs at least one Slot'
    if (s.on_for_new_titles && onCount === 1) return 'At least one Slot must be on for new Titles'
    return undefined
  }

  return (
    <SettingsSection
      title={embedded ? undefined : 'Slots'}
      count={embedded ? undefined : rows.length}
      action={
        <Button size="small" disabled={declared || full} title={full ? 'A library has at most four Slots: remove one to add another' : undefined} onClick={() => setEditing('new')}>
          Add Slot…
        </Button>
      }
    >
      <SlotWarnings />
      <Entity.List aria-label="Slots" onReorder={declared ? undefined : move}>
        {rows.map((s) => {
          const n = held(s.id)
          const lastOn = s.on_for_new_titles && onCount === 1
          const reason = deleteReason(s)
          return (
            <Entity
              key={s.id}
              aria-label={s.label}
              reorderLabel={s.label}
              right={
                <>
                  {n !== undefined && <span className="text-[13px]">{plural(n, 'Version')}</span>}
                  <Toggle
                    aria-label={`${s.label} on for new Titles`}
                    title={lastOn ? 'At least one Slot must be on for new Titles' : undefined}
                    checked={s.on_for_new_titles}
                    disabled={declared || lastOn || patch.isPending}
                    onChange={(on) => patch.mutate({ id: s.id, patch: { on_for_new_titles: on } })}
                  />
                  <DotsMenu aria-label={`${s.label} actions`} size="tiny">
                    <MenuItem disabled={declared} description={declared ? 'The Config File declares it' : undefined} onClick={() => setEditing(s.id)}>
                      Edit…
                    </MenuItem>
                    <MenuItem type="error" disabled={reason !== undefined} description={reason} onClick={() => setDeleting(s.id)}>
                      Delete…
                    </MenuItem>
                  </DotsMenu>
                </>
              }
            >
              <Entity.Content fill title={s.label} description={defaultsText(s, profiles.data)} />
            </Entity>
          )
        })}
      </Entity.List>
      {patch.isError && (
        <Note variant="error" size="small">
          {problemText(patch.error)}
        </Note>
      )}
      <span className="label-12 text-gray-900">
        {declared
          ? 'The Config File sets the Slots, so they cannot be changed here. Change the file and restart Kestrel instead.'
          : 'A Slot is a named place in every Title that holds at most one Version: its label names the files. Drag to change the order.'}
      </span>
      {editing === 'new' && <SlotForm profiles={profiles.data} titles={titles.data ?? []} onClose={() => setEditing(null)} />}
      {editingSlot && <SlotForm key={editingSlot.id} slot={editingSlot} profiles={profiles.data} titles={titles.data ?? []} onClose={() => setEditing(null)} />}
      {deletingSlot && <DeleteSlot slot={deletingSlot} titles={titles.data ?? []} remove={remove} onClose={() => setDeleting(null)} />}
    </SettingsSection>
  )
}
