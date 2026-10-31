// The filter field of a list screen with a dropdown per qualifier that has a `label`, GitHub-style.
// The query text is the only state: the menus read their rows off it and write back to it. On a
// phone they flow onto rows under the field.
import { QueryBar, type FilterMenuItemProps } from '@hyprsh/design'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Facet } from './qualifiers'

const rowsOf = (q: Facet, suffix?: (name: string, value: string) => ReactNode): FilterMenuItemProps[] =>
  [...(q.values ?? q.suggestions ?? [])].map((value) => ({
    value,
    label: q.options?.[value]?.label,
    description: q.options?.[value]?.description,
    suffix: suffix?.(q.name, value),
  }))

export function FilterBar({
  id,
  label,
  value,
  onChange,
  qualifiers,
  placeholder,
  onKeyDown,
  suffix,
  menus: showMenus = true,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  qualifiers: readonly Facet[]
  placeholder?: string
  /** Keys the field leaves alone (it owns the arrows, Enter, Tab and Escape while suggestions are open); preventDefault keeps Enter and Escape from leaving the field. */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  /** A hint after a row's label, such as how many Grabs are in a stage. */
  suffix?: (qualifier: string, value: string) => ReactNode
  /** Whether the menus show; a phone screen can keep them behind a Filters button of its own. */
  menus?: boolean
}) {
  const menus = qualifiers.filter((q) => q.label)

  const items = menus.map((q) =>
    q.single ? (
      <QueryBar.Menu key={q.name} qualifier={q.name} label={q.label!} single defaultOption="default" align="start" items={[{ value: 'default', label: q.single }, ...rowsOf(q, suffix)]} />
    ) : (
      <QueryBar.Menu key={q.name} qualifier={q.name} label={q.label!} align="start" items={rowsOf(q, suffix)} />
    ),
  )

  return (
    <QueryBar
      id={id}
      aria-label={label}
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      qualifiers={qualifiers}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && (e.key === 'Escape' || e.key === 'Enter')) e.currentTarget.blur()
      }}
    >
      {showMenus && items}
    </QueryBar>
  )
}
