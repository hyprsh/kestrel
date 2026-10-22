// What a screen's qualifier table adds to the design's `Qualifier` (name, help, values or
// suggestions, excludable): a label, and for each value a label and a description, which the
// filter menus (FilterBar) show. The grammar itself is the design's: parseQuery, suggestQuery.
import type { Qualifier } from '@hyprsh/design'

/** How a menu shows one value of a qualifier; without a label the value itself is shown. */
type ValueText = { label?: string; description?: string }

/** A qualifier a screen understands. With a `label` it also gets a filter menu beside the field. */
export type Facet = Qualifier & {
  /** The menu's name, plural for a list ("States"); no label, no menu. */
  label?: string
  /** A menu that picks one value, like a sort: the label of the row that means no `name:` at all. */
  single?: string
  /** Labels and descriptions of the values, by value. */
  options?: Readonly<Record<string, ValueText>>
}

/** `kind:` as the screens that list Titles take it: Movies or Series. */
export const kindQualifier = (excludable = false): Facet => ({ name: 'kind', help: 'Movies or Series', values: ['movie', 'series'], excludable })
