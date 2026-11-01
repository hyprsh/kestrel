import { Button, Note, Select, Sheet, Toggle } from '@hyprsh/design'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useProfileDetails, type ProfileDetail, type ProfileScoring } from '../api/downloads'
import { ApiError, usePatchProfile, useProfiles, type Profile, type ProfilePatch } from '../api/queries'
import { plural } from '../format'
import { DefaultsLine, ProfileCard, ProfileFacts, QualityChip, QualityChips, QualityItem, QualityList } from '../layout/SettingsLists'
import { SettingRow, SettingsBlock, SettingsCard } from '../layout/SettingsPage'
import { slotLabel } from '../library/bits'
import { SkeletonRows } from '../loading'
import { useReport } from '../toasts'
import { DefaultsPerSlot, declaredNote, declaresProfiles } from './Profiles'

/** What a Primary-Language Profile does with a Release that has the Original Language but no Primary-Language audio. */
const originalChoices: { value: Profile['original_language']; label: string }[] = [
  { value: 'reject', label: 'Reject' },
  { value: 'offer', label: 'Offer for approval' },
  { value: 'accept', label: 'Grab' },
]

const sourceRank = (n: string) => (/remux/i.test(n) ? 6 : /blu-?ray/i.test(n) ? 5 : /web-?dl/i.test(n) ? 4 : /web-?rip/i.test(n) ? 3 : /hdtv/i.test(n) ? 2 : /dvd/i.test(n) ? 1 : 0)
const heightOf = (n: string) => Number(/(\d{3,4})p/.exec(n)?.[1] ?? 0)

/** Qualities best first: the higher resolution, then the better source. */
const bestFirst = (qualities: string[]) => [...qualities].sort((a, b) => heightOf(b) - heightOf(a) || sourceRank(b) - sourceRank(a) || a.localeCompare(b))

const scoreText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`

/** The kind whose scoring a card shows: Series, or Movies when the Profile has no Series qualities. */
const mainScoring = (d?: ProfileDetail): ProfileScoring | undefined => (d && d.series.qualities.length > 0 ? d.series : d?.movies)

function audioText(p: Profile) {
  if (p.language_rule === 'original') return 'Title’s Original Language audio'
  return p.original_language === 'reject' ? 'Primary Language audio' : 'Primary Language audio, or the original'
}

/**
 * Settings, Profiles: the defaults for new Titles, then one card per Profile with its qualities and facts. A Profile opens in a
 * side sheet. The qualities, Scores and Custom Formats come from TRaSH and are shown, not edited; what a Profile lets you set
 * is whether it is on and what it does with a Release that has only the Original Language.
 */
export function ProfilesSection() {
  const profiles = useProfiles()
  const details = useProfileDetails()
  const [open, setOpen] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(false)
  if (profiles.isError)
    return (
      <Note variant="error" size="small">
        Could not load the Profiles.
      </Note>
    )
  if (!profiles.data) return <SkeletonRows count={3} />
  const list = profiles.data
  const detailOf = (key: string) => details.data?.find((d) => d.key === key)
  const nameOf = (flag: 'default_movies' | 'default_series', slot: Profile['slot']) => list.find((p) => p.slot === slot && p[flag])?.name

  const defaultsText = (slot: Profile['slot']) => {
    const movies = nameOf('default_movies', slot)
    const series = nameOf('default_series', slot)
    if (movies === series) return movies ?? 'None'
    return `Movies ${movies ?? 'none'}, Series ${series ?? 'none'}`
  }
  const sheeted = list.find((p) => p.key === open)

  return (
    <div className="flex flex-col gap-3">
      <DefaultsLine
        label="New Titles get"
        action={
          <Button size="small" variant="tertiary" aria-expanded={defaults} onClick={() => setDefaults((d) => !d)}>
            {defaults ? 'Done' : 'Change…'}
          </Button>
        }
      >
        <span>
          Standard <b>{defaultsText('standard')}</b>
        </span>
        <span>
          4K <b>{defaultsText('4k')}</b>
        </span>
      </DefaultsLine>
      {defaults && (
        <SettingsBlock>
          <DefaultsPerSlot />
        </SettingsBlock>
      )}
      {list.map((p) => {
        const d = detailOf(p.key)
        const scoring = mainScoring(d)
        const uses = !p.enabled ? 'Off' : d && d.titles > 0 ? `${slotLabel[p.slot]} · ${plural(d.titles, 'Title')}` : `${slotLabel[p.slot]} · unused`
        const defaultFor = [p.default_movies ? 'Movies' : null, p.default_series ? 'Series' : null].filter(Boolean).join(' and ')
        return (
          <ProfileCard
            key={p.key}
            name={p.name}
            uses={uses}
            selected={open === p.key}
            action={
              <Button size="small" variant="tertiary" aria-label={`Edit ${p.name}`} onClick={() => setOpen(p.key)}>
                Edit
              </Button>
            }
          >
            {scoring && scoring.qualities.length > 0 && (
              <QualityChips>
                {bestFirst(scoring.qualities).map((q) => (
                  <QualityChip key={q}>{q}</QualityChip>
                ))}
              </QualityChips>
            )}
            <ProfileFacts>
              {scoring && <span>Minimum Score {scoring.min_score}</span>}
              <span>{audioText(p)}</span>
              {defaultFor && <span>Default for {defaultFor}</span>}
            </ProfileFacts>
          </ProfileCard>
        )
      })}
      {declaresProfiles(list) && declaredNote}
      {sheeted && <ProfileSheet key={sheeted.key} profile={sheeted} detail={detailOf(sheeted.key)} declared={declaresProfiles(list)} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ProfileSheet({ profile: p, detail, declared, onClose }: { profile: Profile; detail?: ProfileDetail; declared: boolean; onClose: () => void }) {
  const patch = usePatchProfile()
  const report = useReport()
  const [enabled, setEnabled] = useState(p.enabled)
  const [original, setOriginal] = useState(p.original_language)
  const [kind, setKind] = useState<'series' | 'movies'>(detail && detail.series.qualities.length === 0 ? 'movies' : 'series')
  const [allFormats, setAllFormats] = useState(false)
  const scoring = detail?.[kind]
  const changes: ProfilePatch = {}
  if (enabled !== p.enabled) changes.enabled = enabled
  if (original !== p.original_language) changes.original_language = original
  const dirty = Object.keys(changes).length > 0
  const formats = scoring?.custom_formats ?? []
  const shown = allFormats ? formats : formats.slice(0, 3)

  const save = async () => {
    const r = await report(patch.mutateAsync({ key: p.key, patch: changes }), { done: `Saved ${p.name}` })
    if (r !== undefined) onClose()
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} modal>
      <Sheet.Content side="right" aria-label={`Edit ${p.name}`}>
        <Sheet.Header>
          <Sheet.Title>{p.name}</Sheet.Title>
        </Sheet.Header>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4">
          <Note size="small">
            {declared
              ? 'The Config File sets the Profiles, so nothing here can be changed. Change the file and restart Kestrel instead.'
              : 'The qualities, Scores and Custom Formats come from TRaSH and change with it, so they are shown here but not edited.'}
          </Note>
          {detail && detail.movies.qualities.length > 0 && detail.series.qualities.length > 0 && (
            <Select
              size="small"
              label="Show for"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'series' | 'movies')}
              options={[
                { value: 'series', label: 'Series' },
                { value: 'movies', label: 'Movies' },
              ]}
            />
          )}
          <div className="flex flex-col gap-2">
            <h4 className="label-14 font-semibold">Qualities, best first</h4>
            {scoring && scoring.qualities.length > 0 ? (
              <QualityList>
                {bestFirst(scoring.qualities).map((q) => (
                  <QualityItem key={q}>
                    <Check aria-hidden className="size-3.5" />
                    <span>{q}</span>
                  </QualityItem>
                ))}
              </QualityList>
            ) : (
              <p className="copy-13 text-gray-900">No TRaSH snapshot is active yet, so there are no qualities to show.</p>
            )}
          </div>
          <SettingsCard>
            <SettingRow label="Enabled" help="A disabled Profile is not offered for new Versions, and its defaults are cleared.">
              <Toggle aria-label="Enabled" checked={enabled} disabled={declared} onChange={setEnabled} />
            </SettingRow>
            <SettingRow label="Minimum Score" help="A Release scoring under this is rejected.">
              <span className="label-14">{scoring ? scoring.min_score : '—'}</span>
            </SettingRow>
            <SettingRow label="Audio" help={audioText(p)}>
              {p.language_rule === 'primary' && (
                <Select
                  size="small"
                  aria-label="Original Language only"
                  value={original}
                  disabled={declared}
                  onChange={(e) => setOriginal(e.target.value as Profile['original_language'])}
                  options={originalChoices}
                />
              )}
            </SettingRow>
          </SettingsCard>
          {p.language_rule === 'primary' && (
            <p className="label-12 -mt-3 text-gray-900">Original Language only is what happens to a Release that has the Title’s Original Language but no Primary Language audio.</p>
          )}
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
          {patch.isError && (
            <Note variant="error" size="small">
              {patch.error instanceof ApiError && patch.error.status === 422 ? patch.error.message : 'Could not save. Try again.'}
            </Note>
          )}
        </div>
        <Sheet.Footer>
          <span className="label-13 min-w-0 flex-1 self-center text-gray-900">{detail ? `${plural(detail.files, 'file')} in ${plural(detail.titles, 'Title')} use this Profile` : ''}</span>
          <Button size="small" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="primary" disabled={declared || !dirty || patch.isPending} loading={patch.isPending} onClick={() => void save()}>
            Save
          </Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet>
  )
}
