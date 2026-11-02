import { Checkbox, Input, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalTitle, Note, Select, Toggle } from '@hyprsh/design'
import { useEffect, useState } from 'react'
import { useBulkTitles } from '../api/bulk'
import { ApiError, type Profile, type TitleRow } from '../api/queries'
import { useCreateSlot, usePatchSlot, useRenamePreview, type Slot, type SlotCreate, type SlotPatch } from '../api/slots'
import { plural } from '../format'
import { useReport } from '../toasts'

/** The file name the label shows in: `Title (Year) {tmdb-693134} - [Label][Bluray-1080p]-Group.mkv` (ADR 0003, ADR 0024). */
const previewName = (label: string) => `… {tmdb-693134} - [${label.trim() || 'Label'}][Bluray-1080p]…`

/** `value` once it has stayed the same for `ms`, so a rename is asked about when the typing pauses. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

const fieldOf = (e: unknown, field: string) => (e instanceof ApiError ? e.fields.find((f) => f.field === field)?.message : undefined)

/**
 * "Add Slot…" and "Edit…": the label with a live preview of the file name it makes, the default Profile for Movies and for
 * Series, and whether new Titles get the Slot. Adding also offers to give the existing Titles a Version in it; Editing a
 * label says how many files the rename touches before it is saved. A broken rule shows under its field.
 */
export function SlotForm({ slot, profiles, titles, onClose }: { slot?: Slot; profiles: Profile[]; titles: TitleRow[]; onClose: () => void }) {
  const create = useCreateSlot()
  const patch = usePatchSlot()
  const bulk = useBulkTitles()
  const report = useReport()
  const [label, setLabel] = useState(slot?.label ?? '')
  const [movies, setMovies] = useState(slot?.default_movies ?? '')
  const [series, setSeries] = useState(slot?.default_series ?? '')
  const [on, setOn] = useState(slot?.on_for_new_titles ?? false)
  const [existing, setExisting] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)
  const preview = useRenamePreview(slot, useSettled(label, 300))
  const mutation = slot ? patch : create

  const enabled = profiles.filter((p) => p.enabled)
  const ids = (kind: TitleRow['kind']) => titles.filter((t) => t.kind === kind).map((t) => t.id)
  const nMovies = ids('movie').length
  const nSeries = ids('series').length

  const changes: SlotPatch = {
    ...(slot && label !== slot.label ? { label } : {}),
    ...(slot && movies !== (slot.default_movies ?? '') ? { default_movies: movies } : {}),
    ...(slot && series !== (slot.default_series ?? '') ? { default_series: series } : {}),
    ...(slot && on !== slot.on_for_new_titles ? { on_for_new_titles: on } : {}),
  }
  const renames = slot && label !== slot.label && preview.data !== undefined ? preview.data : undefined
  const labelError = fieldOf(problem, 'label') ?? fieldOf(preview.error, 'label')
  const otherProblem = problem !== null && !(problem instanceof ApiError && problem.fields.length > 0)

  const submit = async () => {
    setProblem(null)
    try {
      if (slot) {
        await patch.mutateAsync({ id: slot.id, patch: changes })
      } else {
        const body: SlotCreate = { label, ...(movies ? { default_movies: movies } : {}), ...(series ? { default_series: series } : {}), on_for_new_titles: on }
        const made = await create.mutateAsync(body)
        // The Versions are Wanted, so the sweep searches them like the rest of the wanted list, not all at once.
        const asks = existing
          ? [
              { kind: 'movie' as const, profile: movies },
              { kind: 'series' as const, profile: series },
            ].filter((a) => a.profile && ids(a.kind).length > 0)
          : []
        if (asks.length > 0)
          await report(Promise.all(asks.map((a) => bulk.mutateAsync({ action: 'add_version', title_ids: ids(a.kind), slot: made.id, profile: a.profile }))), {
            done: (results) => {
              const all = results.flat()
              const added = all.filter((o) => o.outcome === 'changed').length
              return `Added ${made.label} to ${plural(added, 'Title')}${added < all.length ? `, ${all.length - added} skipped` : ''}`
            },
            warn: (results) => results.flat().some((o) => o.outcome !== 'changed'),
            failed: `Could not add ${made.label} to the existing Titles`,
          })
      }
      onClose()
    } catch (e) {
      setProblem(e)
    }
  }

  const profileOptions = (
    <>
      <option value="">None</option>
      {enabled.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name}
        </option>
      ))}
    </>
  )
  const title = slot ? 'Edit Slot' : 'Add Slot'
  const nothingToSave = slot ? Object.keys(changes).length === 0 : label.trim() === ''

  return (
    <Modal open onClose={onClose}>
      <ModalBody>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <div role="group" aria-label={title} className="flex flex-col gap-3">
          <Input size="small" label="Label" value={label} maxLength={24} error={labelError} onChange={(e) => setLabel(e.target.value)} />
          <p className="label-12-mono text-gray-900">{previewName(label)}</p>
          {renames !== undefined && <p className="label-12 text-gray-900">Renames {plural(renames, 'file')}</p>}
          <Select size="small" label="Default for Movies" value={movies} error={fieldOf(problem, 'default_movies')} onChange={(e) => setMovies(e.target.value)}>
            {profileOptions}
          </Select>
          <Select size="small" label="Default for Series" value={series} error={fieldOf(problem, 'default_series')} onChange={(e) => setSeries(e.target.value)}>
            {profileOptions}
          </Select>
          <Toggle labelCasing="normal" checked={on} onChange={setOn}>
            On for new Titles
          </Toggle>
          {!slot && (
            <Checkbox checked={existing} onChange={(e) => setExisting(e.target.checked)}>
              {`Also add to existing Movies (${nMovies}) / Series (${nSeries})`}
            </Checkbox>
          )}
          {otherProblem && (
            <Note variant="error" size="small">
              {problem instanceof ApiError ? problem.message : 'Could not save. Try again.'}
            </Note>
          )}
        </div>
      </ModalBody>
      <ModalActions>
        <ModalAction variant="secondary" onClick={onClose}>
          Cancel
        </ModalAction>
        <ModalAction disabled={mutation.isPending || bulk.isPending || nothingToSave} onClick={() => void submit()}>
          {slot ? 'Save' : 'Add Slot'}
        </ModalAction>
      </ModalActions>
    </Modal>
  )
}
