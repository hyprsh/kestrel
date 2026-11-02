import { Button, Input, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalTitle, Note, Select } from '@hyprsh/design'
import { useState } from 'react'
import { useProfileDetails, type ProfileDetail, type ProfileScoring } from '../api/downloads'
import { useCreateProfile, useProfiles, type Profile } from '../api/queries'
import { declaresSlots, useSlots, type Slot } from '../api/slots'
import { ProfileWarnings } from './ProfileWarnings'
import { plural } from '../format'
import { DefaultsLine, ProfileCard, ProfileFacts, QualityChip, QualityChips } from '../layout/SettingsLists'
import { SettingsBlock } from '../layout/SettingsPage'
import { SkeletonRows } from '../loading'
import { useReport } from '../toasts'
import { DefaultsPerSlot, declaredNote, declaredSlotsNote, declaresProfiles } from './Profiles'
import { cardLadder, qualityLabel, sizeFacts, upgradeFact } from './ladder'
import { ProfileSheet } from './ProfileSheet'
import { audioText, familyName, kindsText } from './recipe'
import { Suggested } from './Suggested'

/** The kind whose scoring a card shows: Series, or Movies when the Profile has no Series qualities. */
const mainScoring = (d?: ProfileDetail): ProfileScoring | undefined => (d && d.series.qualities.length > 0 ? d.series : d?.movies)

/**
 * Settings, Slots & Profiles, Profiles: "New Profile…", the defaults for new Titles, then one card per Profile: its qualities as a ladder (the
 * cutoff dark, those turned off struck through) and its facts. A Profile opens in a side sheet. The Custom Formats and Scores
 * come from TRaSH and are shown; the household sets the order and acceptance of the qualities, where Upgrades stop, the sizes
 * and what happens to a Release with only the Original Language.
 */
export function ProfilesSection() {
  const profiles = useProfiles()
  const slots = useSlots()
  const details = useProfileDetails()
  const [open, setOpen] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(false)
  const [making, setMaking] = useState(false)
  if (profiles.isError || slots.isError)
    return (
      <Note variant="error" size="small">
        Could not load the Profiles.
      </Note>
    )
  if (!profiles.data || !slots.data) return <SkeletonRows count={3} />
  const list = profiles.data
  const declared = declaresProfiles(list)
  const slotsDeclared = declaresSlots(slots.data)
  const detailOf = (key: string) => details.data?.find((d) => d.key === key)
  const nameOf = (key: string | null) => (key ? (list.find((p) => p.key === key)?.name ?? key) : undefined)

  const defaultsText = (slot: Slot) => {
    const movies = nameOf(slot.default_movies)
    const series = nameOf(slot.default_series)
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
          <Button size="small" variant="tertiary" aria-expanded={defaults} disabled={slotsDeclared} onClick={() => setDefaults((d) => !d)}>
            {defaults ? 'Done' : 'Change…'}
          </Button>
        }
      >
        {slots.data.map((slot) => (
          <span key={slot.id}>
            {slot.label} <b>{defaultsText(slot)}</b>
          </span>
        ))}
      </DefaultsLine>
      {slotsDeclared && declaredSlotsNote}
      {defaults && (
        <SettingsBlock>
          <DefaultsPerSlot />
        </SettingsBlock>
      )}
      <ProfileWarnings />
      {list.map((p) => {
        const d = detailOf(p.key)
        const scoring = mainScoring(d)
        const uses = !p.enabled ? 'Off' : d && d.titles > 0 ? plural(d.titles, 'Title') : 'Unused'
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
              <span>{familyName(p.release_family)}</span>
              <span>{kindsText(p.kinds)}</span>
              {d && sizeFacts(d.overlay).map((text) => <span key={text}>{text}</span>)}
              <span>{audioText(p)}</span>
              {d && <span>{upgradeFact(d.overlay, cutoff)}</span>}
              {d && d.below_cutoff > 0 && <span>{plural(d.below_cutoff, 'file')} below the cutoff</span>}
              {defaultFor && <span>Default for {defaultFor}</span>}
            </ProfileFacts>
          </ProfileCard>
        )
      })}
      <Suggested declared={declared} />
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
          <p className="label-12 text-gray-900">A copy of that Profile’s audio, qualities, cutoff and sizes. You change the copy in its sheet.</p>
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
