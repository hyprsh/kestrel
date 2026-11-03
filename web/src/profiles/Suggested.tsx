import { Badge, Button, Collapse, Entity } from '@hyprsh/design'
import { useState } from 'react'
import { useImportProfile, useProfileSuggestions, type ProfileSuggestion } from '../api/queries'
import { useReport } from '../toasts'
import { kindsText, recipeLanguage, usePrimaryName } from './recipe'

type Group = { release_family: string; name: string; items: ProfileSuggestion[] }

/** The groups that still have an item after `keep`. */
const only = (groups: readonly Group[], keep: (s: ProfileSuggestion) => boolean): Group[] => groups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length > 0)

/**
 * "Suggested": the Profiles the household could add, by Release Family, each one click away. The whole section folds: it
 * starts open when `startOpen` (the wizard, or Settings while there are no Profiles) and closed otherwise. The Primary and
 * Original recipes come first; the named-language ones wait under "Other languages", closed. Each row ends with a chip
 * naming the language the recipe uses with the current Primary Language. Nothing while there are none, and read-only
 * when the Config File declares the Profiles. Settings, Slots & Profiles and the wizard's Profiles step share it.
 */
export function Suggested({ declared = false, startOpen = false }: { declared?: boolean; startOpen?: boolean }) {
  const suggestions = useProfileSuggestions()
  const add = useImportProfile()
  const report = useReport()
  const primary = usePrimaryName()
  const [open, setOpen] = useState(startOpen)
  const groups = suggestions.data ?? []
  if (groups.length === 0) return null
  const run = (s: ProfileSuggestion) => report(add.mutateAsync(s), { done: `Added ${s.name}`, failed: `Could not add ${s.name}` })
  const chip = (s: ProfileSuggestion) => {
    const { label, hint } = recipeLanguage(s.language_rule, primary)
    return (
      <Badge size="sm" contrast="low" title={hint}>
        {label}
      </Badge>
    )
  }
  const list = (g: Group) => (
    <div key={g.release_family} role="group" aria-label={g.name} className="flex flex-col gap-1">
      <h4 className="label-13 text-gray-900">{g.name}</h4>
      <Entity.List>
        {g.items.map((s) => (
          <Entity
            key={`${s.resolution}-${s.language_rule}`}
            right={
              <Button size="small" variant="secondary" aria-label={`Add ${s.name}`} disabled={declared || add.isPending} onClick={() => void run(s)}>
                Add
              </Button>
            }
          >
            <Entity.Content
              fill
              title={s.name}
              description={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-normal">
                  <span>{kindsText(s.kinds)}</span>
                  {chip(s)}
                </span>
              }
            />
          </Entity>
        ))}
      </Entity.List>
    </div>
  )
  const common = only(groups, (s) => s.language_rule === 'primary' || s.language_rule === 'original')
  const other = only(groups, (s) => s.language_rule !== 'primary' && s.language_rule !== 'original')
  return (
    <div className="pt-2">
      <Collapse title="Suggested" size="small" expanded={open} onChange={setOpen} headingLevel={3}>
        <div className="flex flex-col gap-2.5">
          {common.map(list)}
          {other.length > 0 && (
            <Collapse title="Other languages" variant="inline">
              <div className="flex flex-col gap-2.5 pt-2.5">{other.map(list)}</div>
            </Collapse>
          )}
        </div>
      </Collapse>
    </div>
  )
}
