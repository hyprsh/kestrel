import { Button } from '@hyprsh/design'
import { useImportProfile, useProfileSuggestions, type ProfileSuggestion } from '../api/queries'
import { SuggestionGroup, SuggestionMore, SuggestionRow } from '../layout/SettingsLists'
import { useReport } from '../toasts'
import { kindsText, languageText, usePrimaryName } from './recipe'

type Group = { release_family: string; name: string; items: ProfileSuggestion[] }

/** The groups that still have an item after `keep`. */
const only = (groups: readonly Group[], keep: (s: ProfileSuggestion) => boolean): Group[] => groups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length > 0)

/**
 * "Suggested": the Profiles the household could add, by Release Family, each one click away. The Primary and Original
 * recipes come first; the named-language ones wait under "Other languages", closed. Nothing while there are none, and
 * read-only when the Config File declares the Profiles. Settings, Profiles and the wizard's Profiles step share it.
 */
export function Suggested({ declared = false }: { declared?: boolean }) {
  const suggestions = useProfileSuggestions()
  const add = useImportProfile()
  const report = useReport()
  const primary = usePrimaryName()
  const groups = suggestions.data ?? []
  if (groups.length === 0) return null
  const run = (s: ProfileSuggestion) => report(add.mutateAsync(s), { done: `Added ${s.name}`, failed: `Could not add ${s.name}` })
  const list = (g: Group) => (
    <SuggestionGroup key={g.release_family} name={g.name}>
      {g.items.map((s) => (
        <SuggestionRow
          key={`${s.resolution}-${s.language_rule}`}
          name={s.name}
          holds={`${kindsText(s.kinds)} · ${languageText(s.language_rule, primary)}`}
          action={
            <Button size="small" variant="secondary" aria-label={`Add ${s.name}`} disabled={declared || add.isPending} onClick={() => void run(s)}>
              Add
            </Button>
          }
        />
      ))}
    </SuggestionGroup>
  )
  const common = only(groups, (s) => s.language_rule === 'primary' || s.language_rule === 'original')
  const other = only(groups, (s) => s.language_rule !== 'primary' && s.language_rule !== 'original')
  return (
    <section aria-label="Suggested" className="flex flex-col gap-2.5 pt-2">
      <h3 className="label-14 font-medium">Suggested</h3>
      {common.map(list)}
      {other.length > 0 && <SuggestionMore summary="Other languages">{other.map(list)}</SuggestionMore>}
    </section>
  )
}
