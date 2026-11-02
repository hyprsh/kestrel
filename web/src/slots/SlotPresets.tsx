import { Button, Note } from '@hyprsh/design'
import { ApiError } from '../api/queries'
import { useApplySlotPreset, useSlotPresets, type SlotPreset } from '../api/slots'
import { SettingRow, SettingsCard } from '../layout/SettingsPage'

/** "Standard: Movies HD, Series HD · Remux: Movies 4K Remux, Series none (off for new Titles)". */
const describe = (p: SlotPreset) =>
  p.slots.map((s) => `${s.label}: Movies ${s.default_movies ?? 'none'}, Series ${s.default_series ?? 'none'}${s.on_for_new_titles ? '' : ' (off for new Titles)'}`).join(' · ')

const problemText = (e: unknown) => (e instanceof ApiError && [409, 422].includes(e.status) ? e.message : 'Could not apply the preset. Try again.')

/**
 * The setup wizard's Slot presets (#304), offered while the library holds no Version. Choosing one replaces the Slots with
 * the preset's, imports and enables each default Profile, and sets the defaults, all or nothing. Renders nothing once the
 * server offers none (a Version exists, or the Config File declares the Slots).
 */
export function SlotPresets() {
  const presets = useSlotPresets()
  const apply = useApplySlotPreset()
  if (!presets.data?.available) return null
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="heading-16">Start from a preset</h3>
      <SettingsCard>
        {presets.data.items.map((p) => (
          <SettingRow key={p.id} label={p.name} help={describe(p)}>
            <Button size="small" disabled={apply.isPending} aria-label={`Use ${p.name}`} onClick={() => apply.mutate(p.id)}>
              Use
            </Button>
          </SettingRow>
        ))}
      </SettingsCard>
      {apply.isError && (
        <Note variant="error" size="small">
          {problemText(apply.error)}
        </Note>
      )}
      <span className="label-12 text-gray-900">A preset replaces the Slots below and enables the Profiles it uses. Change them after, or skip the presets and set them up yourself.</span>
    </div>
  )
}
