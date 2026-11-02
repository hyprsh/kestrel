import { Checkbox, Note } from '@hyprsh/design'
import { ApiError, useImportProfile, usePatchProfile, useProfileSuggestions, useProfiles, type Profile, type ProfileSuggestion } from '../api/queries'
import { useSlots, type Slot } from '../api/slots'
import { SuggestionMore } from '../layout/SettingsLists'
import { SettingsCard } from '../layout/SettingsPage'
import { kindsText, languageText, usePrimaryName } from './recipe'
import { Suggested } from './Suggested'

/** The Slots whose default for some kind is this Profile. */
const defaultOf = (key: string, slots: readonly Slot[]) => slots.filter((s) => s.default_movies === key || s.default_series === key).map((s) => s.label)

/**
 * The suggestions that fit the Slots: the Original-Language twin of each default (HD gives HD Original) and Any for each
 * HD default. The server already leaves out what the household has, enabled or not. The recipe is the Profile's own:
 * its resolution, Release Family and language rule.
 */
function fitting(defaults: readonly Profile[], offered: readonly ProfileSuggestion[]): ProfileSuggestion[] {
  const same = (s: ProfileSuggestion, d: Profile, resolution: Profile['resolution'], rule: Profile['language_rule']) =>
    s.release_family === d.release_family && s.resolution === resolution && s.language_rule === rule
  return offered.filter((s) =>
    defaults.some((d) => {
      const twin = d.language_rule === 'primary' && same(s, d, d.resolution, 'original')
      const any = d.resolution === 'hd' && d.release_family === 'bluray-web' && same(s, d, 'any', d.language_rule)
      return twin || any
    }),
  )
}

const problemText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not change the Profile. Try again.')

/**
 * The wizard's Profiles step: which Profiles to enable. Every Profile the household has is listed, the enabled ones
 * ticked (a Slot's default can't be unticked) and a disabled one unticked, so ticking it enables it again. Then the
 * suggestions that fit the Slots, unticked: ticking one imports it enabled. "More…" opens the whole Suggested list.
 */
export function EnableProfiles() {
  const profiles = useProfiles()
  const slots = useSlots()
  const suggestions = useProfileSuggestions()
  const patch = usePatchProfile()
  const add = useImportProfile()
  const primary = usePrimaryName()
  if (!profiles.data || !slots.data) return null

  const defaults = profiles.data.filter((p) => p.enabled && defaultOf(p.key, slots.data).length > 0)
  const offered = fitting(
    defaults,
    (suggestions.data ?? []).flatMap((g) => g.items),
  )
  const pending = patch.isPending || add.isPending
  const failed = patch.isError ? patch.error : add.isError ? add.error : null

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsCard>
        {profiles.data.map((p) => {
          const labels = defaultOf(p.key, slots.data)
          const locked = p.enabled && labels.length > 0
          return (
            <div key={p.key} className="px-4 py-3">
              <Checkbox
                checked={p.enabled}
                disabled={locked || pending || p.from_config_file}
                onChange={(e) => patch.mutate({ key: p.key, patch: { enabled: e.target.checked } })}
                description={locked ? `The default for ${labels.join(' and ')}, so it stays enabled` : `${kindsText(p.kinds)} · ${languageText(p.language_rule, primary)}`}
              >
                {p.name}
              </Checkbox>
            </div>
          )
        })}
        {offered.map((s) => (
          <div key={`${s.release_family}-${s.resolution}-${s.language_rule}`} className="px-4 py-3">
            <Checkbox checked={false} disabled={pending} onChange={() => add.mutate(s)} description={`Suggested · ${kindsText(s.kinds)} · ${languageText(s.language_rule, primary)}`}>
              {s.name}
            </Checkbox>
          </div>
        ))}
      </SettingsCard>
      {failed && (
        <Note variant="error" size="small">
          {problemText(failed)}
        </Note>
      )}
      <SuggestionMore summary="More…">
        <Suggested />
      </SuggestionMore>
    </div>
  )
}
