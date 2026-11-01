import { Button, DestructiveActionModal, Input, Note, Select, Sheet, Toggle } from '@hyprsh/design'
import { GripVertical } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { ProfileDetail } from '../api/downloads'
import { ApiError, useDeleteProfile, usePatchProfile, type Profile, type ProfilePatch } from '../api/queries'
import { plural } from '../format'
import { QualityBox, QualityItem, QualityList } from '../layout/SettingsLists'
import { SettingRow, SettingsCard } from '../layout/SettingsPage'
import { useReport } from '../toasts'
import { fromGb, moved, qualityLabel, sameLadder, toGb, type Kind, type ProfileOverlay, type ProfileQuality } from './ladder'

/** What a Primary-Language Profile does with a Release that has the Original Language but no Primary-Language audio. */
const originalChoices: { value: Profile['original_language']; label: string }[] = [
  { value: 'reject', label: 'Primary Language audio' },
  { value: 'offer', label: 'Primary Language audio, or the original (offered for approval)' },
  { value: 'accept', label: 'Primary Language audio, or the original language' },
]

const scoreText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`

/** A whole number from a field; null for an empty one, NaN for text that is no number. */
const wholeNumber = (text: string): number | null => (text.trim() === '' ? null : /^[-−]?\d+$/.test(text.trim()) ? Number(text.trim().replace('−', '-')) : NaN)

type Draft = {
  enabled: boolean
  name: string
  original: Profile['original_language']
  ladder: Record<Kind, ProfileQuality[]>
  cutoff: Record<Kind, string>
  until: string
  minScore: string
  episode: [string, string]
  movie: [string, string]
}

function draftOf(p: Profile, d: ProfileDetail): Draft {
  return {
    enabled: p.enabled,
    name: p.name,
    original: p.original_language,
    ladder: { series: d.series.ladder, movies: d.movies.ladder },
    cutoff: { series: d.series.cutoff ?? '', movies: d.movies.cutoff ?? '' },
    until: d.overlay.upgrade_until == null ? '' : String(d.overlay.upgrade_until),
    minScore: String((d.series.ladder.length > 0 ? d.series : d.movies).min_score),
    episode: [toGb(d.overlay.episode_size.min), toGb(d.overlay.episode_size.max)],
    movie: [toGb(d.overlay.movie_size.min), toGb(d.overlay.movie_size.max)],
  }
}

/** The cutoff a draft really has: the quality chosen, as long as the list still accepts it. */
const effectiveCutoff = (d: Draft, kind: Kind) => (d.ladder[kind].some((q) => q.accepted && q.name === d.cutoff[kind]) ? d.cutoff[kind] : '')

/** An overlay as one comparable string. */
const canon = (o: ProfileOverlay) => {
  const kind = (k: ProfileOverlay['series']) => [k.cutoff ?? null, k.qualities ? k.qualities.map((q) => [q.name, q.accepted]) : null]
  return JSON.stringify([
    o.min_score ?? null,
    o.upgrade_until ?? null,
    kind(o.series),
    kind(o.movies),
    [o.episode_size.min ?? null, o.episode_size.max ?? null],
    [o.movie_size.min ?? null, o.movie_size.max ?? null],
  ])
}

/**
 * The overlay a draft saves, or null when it changes nothing. A field left as it was keeps the stored value exactly
 * (a size shown in rounded GB is not rewritten), and a quality list that is TRaSH's own is saved as none.
 */
function overlayOf(d: Draft, start: Draft, detail: ProfileDetail): { overlay: ProfileOverlay | null; invalid?: string } {
  const was = detail.overlay
  const untilNumber = wholeNumber(d.until)
  if (Number.isNaN(untilNumber)) return { overlay: null, invalid: 'Upgrade until Score is a whole number.' }
  let minScore = was.min_score
  if (d.minScore !== start.minScore) {
    const n = wholeNumber(d.minScore)
    if (Number.isNaN(n)) return { overlay: null, invalid: 'Minimum Score is a whole number.' }
    minScore = n
  }
  const size = (now: [string, string], was0: [string, string], stored: { min?: number | null; max?: number | null }, label: string) => {
    const min = now[0] === was0[0] ? (stored.min ?? null) : fromGb(now[0])
    const max = now[1] === was0[1] ? (stored.max ?? null) : fromGb(now[1])
    if (min && max && min > max) return { error: `${label}: the smallest size is above the largest.` }
    return { min, max }
  }
  const episode = size(d.episode, start.episode, was.episode_size, 'Size per episode')
  if ('error' in episode) return { overlay: null, invalid: episode.error }
  const movie = size(d.movie, start.movie, was.movie_size, 'Size per Movie')
  if ('error' in movie) return { overlay: null, invalid: movie.error }
  const kind = (k: Kind) => {
    const own = detail[k]
    return { cutoff: effectiveCutoff(d, k) || null, qualities: sameLadder(d.ladder[k], own.trash_ladder) ? null : d.ladder[k] }
  }
  const overlay: ProfileOverlay = {
    min_score: minScore,
    upgrade_until: untilNumber,
    series: kind('series'),
    movies: kind('movies'),
    episode_size: { min: episode.min, max: episode.max },
    movie_size: { min: movie.min, max: movie.max },
  }
  // Compare with what is stored.
  const stored = canon(was)
  return { overlay: canon(overlay) === stored ? null : overlay }
}

/**
 * One Profile in a side sheet: the draggable quality checklist (best first; the arrow keys on a row's handle move it), where
 * Upgrades stop (the cutoff quality and Score), the minimum Score, the size limits, the audio and a summary of the Custom
 * Formats, which come from TRaSH and are shown, not edited. Nothing is saved until Save.
 */
export function ProfileSheet({ profile: p, detail, declared, onClose }: { profile: Profile; detail?: ProfileDetail; declared: boolean; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} modal>
      <Sheet.Content side="right" aria-label={`Edit ${p.name}`}>
        <Sheet.Header>
          <Sheet.Title>{p.name}</Sheet.Title>
        </Sheet.Header>
        {detail ? (
          <SheetForm profile={p} detail={detail} declared={declared} onClose={onClose} />
        ) : (
          <div className="flex-1 px-5 py-4">
            <p className="copy-13 text-gray-900">Loading the Profile…</p>
          </div>
        )}
      </Sheet.Content>
    </Sheet>
  )
}

function SheetForm({ profile: p, detail, declared, onClose }: { profile: Profile; detail: ProfileDetail; declared: boolean; onClose: () => void }) {
  const patch = usePatchProfile()
  const remove = useDeleteProfile()
  const report = useReport()
  const [start] = useState(() => draftOf(p, detail))
  const [draft, setDraft] = useState(start)
  const [kind, setKind] = useState<Kind>(detail.series.ladder.length === 0 ? 'movies' : 'series')
  const [dragging, setDragging] = useState<number | null>(null)
  const [allFormats, setAllFormats] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [live, setLive] = useState('')

  const scoring = detail[kind]
  const ladder = draft.ladder[kind]
  const cutoff = effectiveCutoff(draft, kind)
  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }))
  const setLadder = (next: ProfileQuality[]) => setDraft((d) => ({ ...d, ladder: { ...d.ladder, [kind]: next } }))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ladder.length || from === to) return
    setLadder(moved(ladder, from, to))
    setLive(`${qualityLabel(ladder[from].name)} is number ${to + 1} of ${ladder.length}`)
  }
  const onHandleKey = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp') move(index, index - 1)
    else if (e.key === 'ArrowDown') move(index, index + 1)
    else return
    e.preventDefault()
  }
  const toggle = (index: number) => setLadder(ladder.map((q, i) => (i === index ? { ...q, accepted: !q.accepted } : q)))
  const reset = () => {
    setDraft((d) => {
      const trash = scoring.trash_ladder
      const keep = trash.some((q) => q.accepted && q.name === d.cutoff[kind]) ? d.cutoff[kind] : ''
      return { ...d, ladder: { ...d.ladder, [kind]: trash }, cutoff: { ...d.cutoff, [kind]: keep }, minScore: String(scoring.trash_min_score) }
    })
    setLive('The qualities are back as TRaSH has them')
  }
  const atTrash = sameLadder(ladder, scoring.trash_ladder) && draft.minScore === String(scoring.trash_min_score)

  const { overlay, invalid } = overlayOf(draft, start, detail)
  const changes: ProfilePatch = {}
  if (draft.enabled !== p.enabled) changes.enabled = draft.enabled
  if (draft.original !== p.original_language) changes.original_language = draft.original
  if (p.custom && draft.name.trim() !== p.name) changes.name = draft.name.trim()
  if (overlay) changes.overlay = overlay
  const dirty = Object.keys(changes).length > 0
  const nameMissing = !!p.custom && draft.name.trim() === ''

  const formats = scoring.custom_formats
  const shown = allFormats ? formats : formats.slice(0, 3)
  const noSnapshot = detail.series.ladder.length === 0 && detail.movies.ladder.length === 0

  const save = async () => {
    const r = await report(patch.mutateAsync({ key: p.key, patch: changes }), { done: `Saved ${draft.name.trim() || p.name}` })
    if (r !== undefined) onClose()
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4">
        {declared && <Note size="small">The Config File sets the Profiles, so nothing here can be changed. Change the file and restart Kestrel instead.</Note>}
        {p.custom && <Input size="small" label="Name" value={draft.name} disabled={declared} onChange={(e) => set({ name: e.target.value })} />}
        {detail.movies.ladder.length > 0 && detail.series.ladder.length > 0 && (
          <Select
            size="small"
            label="Show for"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            options={[
              { value: 'series', label: 'Series' },
              { value: 'movies', label: 'Movies' },
            ]}
          />
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h4 className="label-14 min-w-0 flex-1 font-semibold">Qualities, best first</h4>
            <Button size="tiny" variant="tertiary" disabled={declared || atTrash} onClick={reset}>
              Reset to TRaSH
            </Button>
          </div>
          {ladder.length > 0 ? (
            <QualityList>
              {ladder.map((q, index) => {
                const label = qualityLabel(q.name)
                const isCutoff = q.accepted && q.name === cutoff
                return (
                  <QualityItem
                    key={q.name}
                    cutoff={isCutoff}
                    dragging={dragging === index}
                    draggable={!declared}
                    onDragStart={(e) => {
                      setDragging(index)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', q.name)
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => dragging !== null && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragging !== null) move(dragging, index)
                      setDragging(null)
                    }}
                  >
                    <Button
                      svgOnly
                      variant="tertiary"
                      size="tiny"
                      disabled={declared}
                      aria-label={`Move ${label}`}
                      title="Drag to change the order, or press the up and down arrow keys"
                      onKeyDown={(e) => onHandleKey(e, index)}
                    >
                      <GripVertical />
                    </Button>
                    <QualityBox checked={q.accepted} label={`Accept ${label}`} disabled={declared} onToggle={() => toggle(index)} />
                    <span className={`min-w-0 flex-1 ${q.accepted ? '' : 'text-gray-700'}`}>{label}</span>
                    <span className="label-12 text-gray-900">{isCutoff ? 'cutoff' : q.accepted ? '' : 'not accepted'}</span>
                  </QualityItem>
                )
              })}
            </QualityList>
          ) : (
            <p className="copy-13 text-gray-900">{noSnapshot ? 'No TRaSH snapshot is active yet, so there are no qualities to show.' : 'This Profile has no qualities for that kind.'}</p>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {live}
          </span>
          <span className="label-12 text-gray-900">Kestrel stops upgrading once a file reaches the cutoff and its Score.</span>
        </div>
        <SettingsCard>
          <SettingRow stacked label="Enabled" help="A disabled Profile is not offered for new Versions, and its defaults are cleared.">
            <Toggle aria-label="Enabled" checked={draft.enabled} disabled={declared} onChange={(enabled) => set({ enabled })} />
          </SettingRow>
          <SettingRow
            stacked
            label="Good enough at"
            help={detail.below_cutoff > 0 ? `${plural(detail.below_cutoff, 'file')} below the cutoff in this Profile.` : 'A file of this quality or a better one is not upgraded.'}
          >
            <Select
              size="small"
              aria-label="Good enough at"
              value={cutoff}
              disabled={declared || ladder.length === 0}
              onChange={(e) => setDraft((d) => ({ ...d, cutoff: { ...d.cutoff, [kind]: e.target.value } }))}
            >
              <option value="">No cutoff</option>
              {ladder
                .filter((q) => q.accepted)
                .map((q) => (
                  <option key={q.name} value={q.name}>
                    {qualityLabel(q.name)}
                  </option>
                ))}
            </Select>
          </SettingRow>
          <SettingRow stacked label="Upgrade until Score" help="Once a file is at the cutoff and has this Score, Kestrel stops looking for a better one. Empty leaves only the cutoff.">
            <Input size="small" aria-label="Upgrade until Score" inputMode="numeric" className="w-32" value={draft.until} disabled={declared} onChange={(e) => set({ until: e.target.value })} />
          </SettingRow>
          <SettingRow stacked label="Minimum Score" help={`A Release scoring under this is rejected. TRaSH has ${scoring.trash_min_score}.`}>
            <Input
              size="small"
              aria-label="Minimum Score"
              inputMode="numeric"
              className="w-32"
              value={draft.minScore}
              disabled={declared || ladder.length === 0}
              onChange={(e) => set({ minScore: e.target.value })}
            />
          </SettingRow>
          <SettingRow stacked label="Size per episode" help="A Series Release outside this, per episode, is rejected. You can still grab it. Empty is no limit.">
            <SizeFields label="Size per episode" value={draft.episode} disabled={declared} onChange={(episode) => set({ episode })} />
          </SettingRow>
          <SettingRow stacked label="Size per Movie" help="A Movie Release outside this is rejected. You can still grab it. Empty is no limit.">
            <SizeFields label="Size per Movie" value={draft.movie} disabled={declared} onChange={(movie) => set({ movie })} />
          </SettingRow>
          <SettingRow stacked label="Audio" help={p.language_rule === 'original' ? 'The Title’s Original Language audio.' : 'What a Release with only the Original Language audio does.'}>
            {p.language_rule === 'primary' ? (
              <Select
                size="small"
                aria-label="Audio"
                value={draft.original}
                disabled={declared}
                onChange={(e) => set({ original: e.target.value as Profile['original_language'] })}
                options={originalChoices}
              />
            ) : (
              <span className="label-14">Title’s Original Language audio</span>
            )}
          </SettingRow>
        </SettingsCard>
        <div className="flex flex-col gap-1.5">
          <h4 className="label-14 font-semibold">Custom Formats</h4>
          {formats.length === 0 ? (
            <p className="copy-13 text-gray-900">None scored.</p>
          ) : (
            <p className="copy-13 text-gray-900">
              From TRaSH · {formats.length} scored · {shown.map((f) => `${f.name} ${scoreText(f.score)}`).join(' · ')}
              {formats.length > shown.length && ' …'}{' '}
              {formats.length > 3 && (
                <Button size="tiny" variant="tertiary" onClick={() => setAllFormats((a) => !a)}>
                  {allFormats ? 'Show fewer' : 'Show all'}
                </Button>
              )}
            </p>
          )}
        </div>
        {invalid && (
          <Note variant="error" size="small">
            {invalid}
          </Note>
        )}
        {patch.isError && (
          <Note variant="error" size="small">
            {patch.error instanceof ApiError && patch.error.status === 422 ? patch.error.message : 'Could not save. Try again.'}
          </Note>
        )}
        {p.custom && !declared && (
          <div className="flex items-center gap-3">
            <Button size="small" variant="secondary" disabled={detail.titles > 0} onClick={() => setDeleting(true)}>
              Delete Profile
            </Button>
            {detail.titles > 0 && <span className="label-12 text-gray-900">{plural(detail.titles, 'Title')} use it. Switch their Versions to another Profile first.</span>}
          </div>
        )}
      </div>
      <Sheet.Footer>
        <span className="label-13 min-w-0 flex-1 self-center text-gray-900">{detail.rescores > 0 ? `Saving rescores ${plural(detail.rescores, 'file')}` : 'Saving rescores no files'}</span>
        <Button size="small" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="primary" disabled={declared || !dirty || !!invalid || nameMissing || patch.isPending} loading={patch.isPending} onClick={() => void save()}>
          Save
        </Button>
      </Sheet.Footer>
      <DestructiveActionModal
        open={deleting}
        title="Delete Profile"
        description={`Delete ${p.name}? Nothing uses it. The Profile it was copied from stays.`}
        confirmLabel="Delete Profile"
        loading={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          void report(remove.mutateAsync(p.key), { done: `Deleted ${p.name}`, failed: `Could not delete ${p.name}` }).then((r) => {
            setDeleting(false)
            if (r !== undefined || remove.isSuccess) onClose()
          })
        }
      />
    </>
  )
}

/** The smallest and largest size, in GB. */
function SizeFields({ label, value, disabled, onChange }: { label: string; value: [string, string]; disabled: boolean; onChange: (v: [string, string]) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        size="small"
        aria-label={`${label}, smallest in GB`}
        placeholder="Smallest"
        inputMode="decimal"
        className="w-24"
        value={value[0]}
        disabled={disabled}
        onChange={(e) => onChange([e.target.value, value[1]])}
      />
      <span aria-hidden>–</span>
      <Input
        size="small"
        aria-label={`${label}, largest in GB`}
        placeholder="Largest"
        inputMode="decimal"
        className="w-24"
        value={value[1]}
        disabled={disabled}
        onChange={(e) => onChange([value[0], e.target.value])}
      />
      <span className="label-13 text-gray-900">GB</span>
    </div>
  )
}
