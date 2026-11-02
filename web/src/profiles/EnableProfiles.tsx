import { Checkbox, Link, Note } from '@hyprsh/design'
import { useState } from 'react'
import { ApiError, useImportProfile, usePatchProfile, useProfileSuggestions, useProfiles, type Profile, type ProfileSuggestion } from '../api/queries'
import { useSlots, type Slot } from '../api/slots'
import { SettingsCard } from '../layout/SettingsPage'
import { kindsText, languageText } from './recipe'

type Resolution = ProfileSuggestion['resolution']

/** A Profile's resolution as a recipe names it: 4K, Any (no floor) or HD. */
const resolutionOf = (p: Pick<Profile, 'min_height'>): Resolution => (p.min_height >= 2160 ? 'uhd' : p.min_height === 0 ? 'any' : 'hd')

/** The Slots whose default for some kind is this Profile. */
const defaultOf = (key: string, slots: readonly Slot[]) => slots.filter((s) => s.default_movies === key || s.default_series === key).map((s) => s.label)

/**
 * The suggestions that fit the Slots (ADR 0026): the Original-Language twin of each default (HD gives HD Original) and
 * Any for each HD default. The server already leaves out what the household has.
 */
function fitting(defaults: readonly Profile[], offered: readonly ProfileSuggestion[]): ProfileSuggestion[] {
  const same = (s: ProfileSuggestion, d: Profile, resolution: Resolution, rule: ProfileSuggestion['language_rule']) =>
    s.release_family === d.release_family && s.resolution === resolution && s.language_rule === rule
  return offered.filter((s) =>
    defaults.some((d) => {
      const res = resolutionOf(d)
      const twin = d.language_rule === 'primary' && same(s, d, res, 'original')
      const any = res === 'hd' && d.release_family === 'bluray-web' && same(s, d, 'any', d.language_rule)
      return twin || any
    }),
  )
}

const problemText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not change the Profile. Try again.')

/**
 * The wizard's Profiles step: which Profiles to enable. The household's enabled Profiles are ticked (a Slot's default
 * can't be unticked), then the suggestions that fit the Slots, unticked. Ticking one imports it enabled; unticking
 * disables a Profile. One that was unticked stays listed so it can be ticked again.
 */
export function EnableProfiles() {
  const profiles = useProfiles()
  const slots = useSlots()
  const suggestions = useProfileSuggestions()
  const patch = usePatchProfile()
  const add = useImportProfile()
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  if (!profiles.data || !slots.data) return null

  const listed = profiles.data.filter((p) => p.enabled || seen.has(p.key))
  const defaults = profiles.data.filter((p) => p.enabled && defaultOf(p.key, slots.data).length > 0)
  const offered = fitting(
    defaults,
    (suggestions.data ?? []).flatMap((g) => g.items),
  )
  const pending = patch.isPending || add.isPending
  const failed = patch.isError ? patch.error : add.isError ? add.error : null

  const toggle = (p: Profile, on: boolean) => {
    setSeen((s) => new Set(s).add(p.key))
    patch.mutate({ key: p.key, patch: { enabled: on } })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsCard>
        {listed.map((p) => {
          const locked = p.enabled && defaultOf(p.key, slots.data).length > 0
          const labels = defaultOf(p.key, slots.data)
          return (
            <div key={p.key} className="px-4 py-3">
              <Checkbox
                checked={p.enabled}
                disabled={locked || pending || p.from_config_file}
                onChange={(e) => toggle(p, e.target.checked)}
                description={locked ? `The default for ${labels.join(' and ')}, so it stays enabled` : `${kindsText(p.kinds)} · ${languageText(p.language_rule)}`}
              >
                {p.name}
              </Checkbox>
            </div>
          )
        })}
        {offered.map((s) => (
          <div key={`${s.release_family}-${s.resolution}-${s.language_rule}`} className="px-4 py-3">
            <Checkbox checked={false} disabled={pending} onChange={() => add.mutate(s)} description={`Suggested · ${kindsText(s.kinds)} · ${languageText(s.language_rule)}`}>
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
      <Link href="/settings/profiles">More…</Link>
    </div>
  )
}
