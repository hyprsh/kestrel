// What a screen's qualifier table adds to the design's `Qualifier` (name, help, values or
// suggestions, excludable): a label, and for each value a label and a description, which the
// filter menus (FilterBar) show. The grammar itself is the design's: parseQuery, suggestQuery.
import type { Qualifier } from '@hyprsh/design'
import type { SlotNames } from '../library/slots'

/** How a menu shows one value of a qualifier; without a label the value itself is shown. */
type ValueText = { label?: string; description?: string }

/** A qualifier a screen understands. With a `label` it also gets a filter menu beside the field. */
export type Facet = Qualifier & {
  /** The menu's name, plural for a list ("States"); no label, no menu. */
  label?: string
  /** A menu that picks one value, like a sort: the label of the row that means no `name:` at all. */
  single?: string
  /** Values the field takes and suggests but the filter menu does not list, such as groups a View already stands for. */
  unlisted?: readonly string[]
  /** Labels and descriptions of the values, by value. */
  options?: Readonly<Record<string, ValueText>>
}

/** `kind:` as the screens that list Titles take it: Movies or Series. */
export const kindQualifier = (excludable = false): Facet => ({ name: 'kind', help: 'Movies or Series', values: ['movie', 'series'], excludable })

/**
 * `slot:` over the library's Slots, in Slot order, all of them whether or not the screen's rows hold a Version there.
 * The menu (given a `label`) lists every Slot, and a library with one Slot has no menu: it would only repeat that label.
 */
export const slotQualifier = (names: SlotNames, text: { help: string; label?: string; excludable?: boolean }): Facet => ({
  name: 'slot',
  help: text.help,
  excludable: text.excludable,
  // Before the list arrives any Slot id is accepted as typed.
  ...(names.list.length > 0 && { values: names.list.map((r) => r.id), options: Object.fromEntries(names.list.map((r) => [r.id, { label: r.label }])) }),
  ...(names.several && text.label && { label: text.label }),
})
