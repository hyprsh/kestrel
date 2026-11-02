import { Button, Input, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalTitle, Note, Select } from '@hyprsh/design'
import { useState } from 'react'
import { useProfileDetails, type ProfileDetail, type ProfileScoring } from '../api/downloads'
import { useCreateProfile, useProfiles, type Profile } from '../api/queries'
import { plural } from '../format'
import { DefaultsLine, ProfileCard, ProfileFacts, QualityChip, QualityChips } from '../layout/SettingsLists'
import { SettingsBlock } from '../layout/SettingsPage'
import { slotLabel } from '../library/bits'
import { SkeletonRows } from '../loading'
import { useReport } from '../toasts'
import { DefaultsPerSlot, declaredNote, declaresProfiles } from './Profiles'
import { cardLadder, qualityLabel, sizeFacts, upgradeFact } from './ladder'
import { ProfileSheet } from './ProfileSheet'

/** The kind whose scoring a card shows: Series, or Movies when the Profile has no Series qualities. */
const mainScoring = (d?: ProfileDetail): ProfileScoring | undefined => (d && d.series.qualities.length > 0 ? d.series : d?.movies)

function audioText(p: Profile) {
  if (p.language_rule === 'original') return 'Title’s Original Language audio'
  return p.original_language === 'reject' ? 'Primary Language audio' : 'Primary Language audio, or the original'
}

/**
 * Settings, Profiles: "New Profile…", the defaults for new Titles, then one card per Profile: its qualities as a ladder (the
 * cutoff dark, those turned off struck through) and its facts. A Profile opens in a side sheet. The Custom Formats and Scores
 * come from TRaSH and are shown; the household sets the order and acceptance of the qualities, where Upgrades stop, the sizes
 * and what happens to a Release with only the Original Language.
 */
export function ProfilesSection() {
  const profiles = useProfiles()
  const details = useProfileDetails()
  const [open, setOpen] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(false)
  const [making, setMaking] = useState(false)
  if (profiles.isError)
    return (
      <Note variant="error" size="small">
        Could not load the Profiles.
      </Note>
    )
  if (!profiles.data) return <SkeletonRows count={3} />
  const list = profiles.data
  const declared = declaresProfiles(list)
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
      <div className="flex justify-end">
        <Button size="small" variant="secondary" disabled={declared} onClick={() => setMaking(true)}>
          New Profile…
        </Button>
      </div>
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
        const place = (p.slot && slotLabel[p.slot]) || 'Any Slot' // a Profile has no Slot of its own now: #293 reworks this row
        const uses = !p.enabled ? 'Off' : d && d.titles > 0 ? `${place} of ${plural(d.titles, 'Title')}` : `${place} · unused`
        const defaultFor = [p.default_movies ? 'Movies' : null, p.default_series ? 'Series' : null].filter(Boolean).join(' and ')
        const cutoff = scoring?.cutoff ?? null
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
            {scoring && scoring.ladder.length > 0 && (
              <QualityChips>
                {cardLadder(scoring.ladder, scoring.trash_ladder).map((q) => (
                  <QualityChip key={q.name} tone={!q.accepted ? 'no' : q.name === cutoff ? 'cutoff' : 'plain'} title={!q.accepted ? 'Not accepted' : q.name === cutoff ? 'Good enough here' : q.name}>
                    {qualityLabel(q.name)}
                  </QualityChip>
                ))}
              </QualityChips>
            )}
            <ProfileFacts>
              {d && sizeFacts(d.overlay).map((text) => <span key={text}>{text}</span>)}
              <span>{audioText(p)}</span>
              {d && <span>{upgradeFact(d.overlay, cutoff)}</span>}
              {d && d.below_cutoff > 0 && <span>{plural(d.below_cutoff, 'file')} below the cutoff</span>}
              {defaultFor && <span>Default for {defaultFor}</span>}
            </ProfileFacts>
          </ProfileCard>
        )
      })}
      {declared && declaredNote}
      {sheeted && <ProfileSheet key={sheeted.key} profile={sheeted} detail={detailOf(sheeted.key)} declared={declared} onClose={() => setOpen(null)} />}
      {making && (
        <NewProfile
          profiles={list}
          onCancel={() => setMaking(false)}
          onMade={(key) => {
            setMaking(false)
            setOpen(key)
          }}
        />
      )}
    </div>
  )
}

/** "New Profile…": a name, and the Profile to start from. */
function NewProfile({ profiles, onCancel, onMade }: { profiles: Profile[]; onCancel: () => void; onMade: (key: string) => void }) {
  const create = useCreateProfile()
  const report = useReport()
  const [name, setName] = useState('')
  const [from, setFrom] = useState(profiles[0]?.key ?? '')
  const submit = async () => {
    const made = await report(create.mutateAsync({ name: name.trim(), copy_from: from }), { done: `Made ${name.trim()}`, failed: 'Could not make the Profile' })
    if (made) onMade(made.key)
  }
  return (
    <Modal open onClose={onCancel}>
      <ModalBody>
        <ModalHeader>
          <ModalTitle>New Profile</ModalTitle>
        </ModalHeader>
        <div role="group" aria-label="New Profile" className="flex flex-col gap-3">
          <Input size="small" label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Select size="small" label="Start from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
          <p className="label-12 text-gray-900">A copy of that Profile’s Slot, audio, qualities, cutoff and sizes. You change the copy in its sheet.</p>
        </div>
      </ModalBody>
      <ModalActions>
        <ModalAction variant="secondary" onClick={onCancel}>
          Cancel
        </ModalAction>
        <ModalAction disabled={create.isPending || name.trim() === ''} onClick={() => void submit()}>
          Create
        </ModalAction>
      </ModalActions>
    </Modal>
  )
}
