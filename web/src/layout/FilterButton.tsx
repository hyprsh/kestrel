// chrome: layout
import { Menu, MenuDivider, MenuItem, MenuSection, parseQuery, termText, withoutTerm, withoutValue, withValue, type Term } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { Facet } from '../filter/qualifiers'

/** The most rows a facet with only suggestions (Titles, Profiles) lists; the rest are typed into the field. */
const SUGGESTED = 12

/** The trigger's text: "Filter", or "Filter · 2" while two are active. */
const filterText = (count: number) => (count > 0 ? `Filter · ${count}` : 'Filter')

/**
 * The one Filter button of a screen bar: a menu of checkable items with a badge for how many are active. It holds what its
 * children say, so a screen without a text filter (Upcoming) puts its toggles in it; a screen with a filter field uses
 * FacetFilterButton, which holds that field's facets.
 */
export function FilterButton({ count, children }: { count: number; children: ReactNode }) {
  return (
    <Menu.Container position="bottom-start">
      <Menu.Button variant="secondary" size="small" showChevron>
        {filterText(count)}
      </Menu.Button>
      <Menu width={260} className="max-h-[min(32rem,70vh)] overflow-y-auto">
        {children}
      </Menu>
    </Menu.Container>
  )
}

/** The query with `value` taken out of the excluded `name:` terms (`-slot:4k`), which the design's withoutValue leaves alone. */
function withoutExcluded(text: string, name: string, value: string, qualifiers: readonly Facet[]): string {
  const terms = parseQuery(text, qualifiers).terms
  const i = terms.findIndex((t: Term) => t.name === name && t.excluded && t.values.includes(value))
  if (i < 0) return text
  const rest = terms[i].values.filter((v) => v !== value)
  if (rest.length === 0) return withoutTerm(text, i, qualifiers)
  const [from, to] = terms[i].span
  return text.slice(0, from) + termText({ ...terms[i], values: rest }) + text.slice(to)
}

/** A facet that is a pick-many list; the one-value ones (Sort) have their own button. */
const isMenu = (f: Facet) => f.label !== undefined && !f.single

/**
 * The Filter button of a screen with a filter field: a section per facet (a qualifier with a `label`), its values as
 * checkable items. The query text is the only state, so ticking a value writes its token into the field (`slot:4k`) and
 * a token typed in the field ticks its row. A value typed as an exclusion (`-slot:4k`) shows as Excluded; choosing it
 * takes the term out. The badge counts the facets that have a term.
 */
export function FacetFilterButton({
  query,
  onQuery,
  qualifiers,
  suffix,
  lead,
  leadActive = 0,
}: {
  query: string
  onQuery: (query: string) => void
  qualifiers: readonly Facet[]
  suffix?: (facet: string, value: string) => ReactNode
  /** Sections above the facets, such as the Library's Status, and how many of them are active. */
  lead?: ReactNode
  leadActive?: number
}) {
  const facets = qualifiers.filter(isMenu)
  const parsed = parseQuery(query, qualifiers)
  const names = new Set(facets.map((f) => f.name))
  const active = new Set(parsed.terms.filter((t) => names.has(t.name)).map((t) => t.name)).size
  return (
    <FilterButton count={active + leadActive}>
      {lead}
      {facets.map((f, i) => {
        const included = new Set(parsed.terms.filter((t) => t.name === f.name && !t.excluded).flatMap((t) => t.values))
        const excluded = new Set(parsed.terms.filter((t) => t.name === f.name && t.excluded).flatMap((t) => t.values))
        const offered = [...(f.values ?? f.suggestions ?? [])]
        // A facet of suggestions lists the chosen ones first, then the start of the rest.
        const values = f.values ? offered : [...new Set([...included, ...excluded, ...offered])].slice(0, Math.max(SUGGESTED, included.size + excluded.size))
        return (
          <div key={f.name}>
            {(i > 0 || lead) && <MenuDivider />}
            <MenuSection title={f.label}>
              {values.map((v) => (
                <MenuItem
                  key={v}
                  checked={included.has(v)}
                  description={f.options?.[v]?.description}
                  suffix={excluded.has(v) ? 'Excluded' : suffix?.(f.name, v)}
                  onSelect={() =>
                    onQuery(excluded.has(v) ? withoutExcluded(query, f.name, v, qualifiers) : included.has(v) ? withoutValue(query, f.name, v, qualifiers) : withValue(query, f.name, v, qualifiers))
                  }
                >
                  {f.options?.[v]?.label ?? v}
                </MenuItem>
              ))}
            </MenuSection>
          </div>
        )
      })}
    </FilterButton>
  )
}

/** The Sort section of a Display menu: one value of a `single` facet, as radio items; the default row takes the term out. */
export function SortSection({ query, onQuery, qualifiers, name = 'sort' }: { query: string; onQuery: (query: string) => void; qualifiers: readonly Facet[]; name?: string }) {
  const facet = qualifiers.find((f) => f.name === name && f.single)
  if (!facet) return null
  const parsed = parseQuery(query, qualifiers)
  const current = parsed.terms.find((t) => t.name === name)?.values[0]
  const rows = [{ value: '', label: facet.single! }, ...(facet.values ?? []).map((v) => ({ value: v, label: facet.options?.[v]?.label ?? v }))]
  const chosen = rows.find((r) => r.value === current) ?? rows[0]
  const set = (value: string) => {
    // Every sort term goes, the last first so the earlier spans stay right, then the chosen one is added.
    let text = query
    const terms = parseQuery(text, qualifiers).terms
    for (let i = terms.length - 1; i >= 0; i--) if (terms[i].name === name) text = withoutTerm(text, i, qualifiers)
    onQuery(value ? withValue(text, name, value, qualifiers) : text)
  }
  return (
    <MenuSection title={facet.label ?? 'Sort'}>
      {rows.map((r) => (
        <MenuItem key={r.value} role="radio" checked={r === chosen} onSelect={() => set(r.value)}>
          {r.label}
        </MenuItem>
      ))}
    </MenuSection>
  )
}
