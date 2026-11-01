// The active filter as removable chips (the SidePanel's FilterChips): one per value of each term in the query, labelled
// by the qualifier's option ("Wanted" for `is:wanted`) or else as typed (`slot:4k`, `-kind:movie`). The sort term is the
// Sort button's, and free text is the field's, so neither is a chip. Removing a chip takes that one value out.
import { parseQuery, termText, withoutValue } from '@hyprsh/design'
import type { FilterChip } from '../layout/SidePanel'
import { withoutExcluded } from '../layout/FilterButton'
import type { Facet } from './qualifiers'

export function filterChips(query: string, onQuery: (query: string) => void, qualifiers: readonly Facet[], skip: readonly string[] = ['sort']): FilterChip[] {
  const chips: FilterChip[] = []
  for (const term of parseQuery(query, qualifiers).terms) {
    if (skip.includes(term.name)) continue
    const facet = qualifiers.find((q) => q.name === term.name)
    for (const value of term.values) {
      const named = facet?.options?.[value]?.label
      const label = named ? `${term.excluded ? 'Not ' : ''}${named}` : termText({ name: term.name, values: [value], excluded: term.excluded })
      chips.push({
        key: `${term.excluded ? '-' : ''}${term.name}:${value}`,
        label,
        onRemove: () => onQuery(term.excluded ? withoutExcluded(query, term.name, value, qualifiers) : withoutValue(query, term.name, value, qualifiers)),
      })
    }
  }
  return chips
}
