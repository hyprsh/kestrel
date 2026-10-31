// chrome: layout
import { Button, Menu, MenuDivider, MenuItem, MenuSection, parseQuery, termText, withoutTerm, withoutValue, withValue, type Term } from '@hyprsh/design'
import { ArrowUpDown, Funnel, Minus, MinusCircle } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { usePhone } from '../responsive'
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
  // A phone has one line for the bar, so the button is a funnel with the count as its badge; its name stays "Filter".
  const phone = usePhone()
  return (
    <Menu.Container position="bottom-start">
      {phone ? (
        <Menu.Button variant="secondary" size="small" svgOnly aria-label="Filter" badge={count} badgeLabel={count > 0 ? `${count} active` : undefined}>
          <Funnel />
        </Menu.Button>
      ) : (
        <Menu.Button variant="secondary" size="small" showChevron>
          {filterText(count)}
        </Menu.Button>
      )}
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

/** The query with `value` excluded: added to the excluded `name:` term (`-slot:4k,standard`) or as a term of its own, and out of the included one. */
function withExcludedValue(text: string, name: string, value: string, qualifiers: readonly Facet[]): string {
  const base = withoutValue(text, name, value, qualifiers)
  const terms = parseQuery(base, qualifiers).terms
  const i = terms.findIndex((t: Term) => t.name === name && t.excluded)
  if (i < 0) return `${base.trimEnd()} ${termText({ name, values: [value], excluded: true })}`.trimStart()
  const [from, to] = terms[i].span
  return base.slice(0, from) + termText({ ...terms[i], values: [...terms[i].values, value] }) + base.slice(to)
}

/** A facet that is a pick-many list; the one-value ones (Sort) have their own button. */
const isMenu = (f: Facet) => f.label !== undefined && !f.single

/**
 * The Filter button of a screen with a filter field: a section per facet (a qualifier with a `label`), its values as
 * checkable items. The query text is the only state, so ticking a value writes its token into the field (`slot:4k`) and
 * a token typed in the field ticks its row. Shift+click or Shift+Enter on a value, or the ⊖ on its row (on hover), writes the exclusion (`-slot:4k`); an excluded
 * value shows a minus and "Excluded", and choosing it takes the term out. The badge counts the facets that have a term, excluded or not.
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
  // A Shift-click or Shift+Enter excludes in the item's onClick, which the menu calls before onSelect: this tells onSelect it has been done.
  const excludedByKey = useRef(false)
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
              {values.map((v) => {
                const label = f.options?.[v]?.label ?? v
                const isExcluded = excluded.has(v)
                const exclude = () => onQuery(withExcludedValue(query, f.name, v, qualifiers))
                const toggle = () =>
                  onQuery(isExcluded ? withoutExcluded(query, f.name, v, qualifiers) : included.has(v) ? withoutValue(query, f.name, v, qualifiers) : withValue(query, f.name, v, qualifiers))
                return (
                  <MenuItem
                    key={v}
                    className="group"
                    checked={included.has(v)}
                    prefix={isExcluded ? <Minus className="size-4 text-red-900" aria-hidden /> : undefined}
                    description={f.options?.[v]?.description}
                    suffix={
                      <>
                        {isExcluded ? <span className="text-red-900">Excluded</span> : suffix?.(f.name, v)}
                        {f.excludable && !isExcluded && (
                          // The exclude action shows on hover or focus; Shift+click and Shift+Enter on the row do the same.
                          <Button
                            svgOnly
                            size="tiny"
                            variant="tertiary"
                            tabIndex={-1}
                            aria-label={`Exclude ${label}`}
                            title={`Exclude ${label}`}
                            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation()
                              exclude()
                            }}
                          >
                            <MinusCircle />
                          </Button>
                        )}
                      </>
                    }
                    onClick={(e) => {
                      if (e.shiftKey && f.excludable && !isExcluded) {
                        excludedByKey.current = true
                        exclude()
                      }
                    }}
                    onSelect={() => {
                      if (excludedByKey.current) excludedByKey.current = false
                      else toggle()
                    }}
                  >
                    {label}
                  </MenuItem>
                )
              })}
            </MenuSection>
          </div>
        )
      })}
      {facets.some((f) => f.excludable) && (
        <>
          <MenuDivider />
          <li role="none" className="label-12 px-3 py-2 text-gray-900">
            Shift-click to exclude
          </li>
        </>
      )}
    </FilterButton>
  )
}

/** The rows of a `single` facet (a sort), which one is chosen, and how to choose another: the default row takes the term out. */
function sortChoice(query: string, onQuery: (query: string) => void, qualifiers: readonly Facet[], name: string) {
  const facet = qualifiers.find((f) => f.name === name && f.single)
  if (!facet) return null
  const current = parseQuery(query, qualifiers).terms.find((t) => t.name === name)?.values[0]
  const rows = [{ value: '', label: facet.single! }, ...(facet.values ?? []).map((v) => ({ value: v, label: facet.options?.[v]?.label ?? v }))]
  const chosen = rows.find((r) => r.value === current) ?? rows[0]
  const set = (value: string) => {
    // Every sort term goes, the last first so the earlier spans stay right, then the chosen one is added.
    let text = query
    const terms = parseQuery(text, qualifiers).terms
    for (let i = terms.length - 1; i >= 0; i--) if (terms[i].name === name) text = withoutTerm(text, i, qualifiers)
    onQuery(value ? withValue(text, name, value, qualifiers) : text)
  }
  return { facet, rows, chosen, set }
}

/** The Sort button: "Sort: Newest added" with its rows as radio items; a phone's one line has an icon button named "Sort". */
export function SortButton({ query, onQuery, qualifiers, name = 'sort' }: { query: string; onQuery: (query: string) => void; qualifiers: readonly Facet[]; name?: string }) {
  const phone = usePhone()
  const choice = sortChoice(query, onQuery, qualifiers, name)
  if (!choice) return null
  const { facet, rows, chosen, set } = choice
  return (
    <Menu.Container position="bottom-start">
      {phone ? (
        <Menu.Button variant="secondary" size="small" svgOnly aria-label="Sort">
          <ArrowUpDown />
        </Menu.Button>
      ) : (
        <Menu.Button variant="secondary" size="small" showChevron>
          {`${facet.label}: ${chosen.label}`}
        </Menu.Button>
      )}
      <Menu width={220} className="max-h-[min(32rem,70vh)] overflow-y-auto">
        {rows.map((r) => (
          <MenuItem key={r.value} role="radio" checked={r === chosen} onSelect={() => set(r.value)}>
            {r.label}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )
}
