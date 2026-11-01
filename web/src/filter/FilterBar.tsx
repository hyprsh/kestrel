// The filter field of a list screen with a dropdown per qualifier that has a `label`, GitHub-style.
// The query text is the only state: the menus read their rows off it and write back to it. On a
// phone they flow onto rows under the field.
import { Button, Kbd, QueryBar, type FilterMenuItemProps } from '@hyprsh/design'
import { X } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { usePhone } from '../responsive'
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
  const phone = usePhone()
  // A placeholder ending in "  /" names the key that focuses the field: it shows as a key cap in the field's end while it is empty.
  const hinted = placeholder?.endsWith('  /') ?? false
  const hint = hinted ? placeholder!.slice(0, -3) : placeholder

  const items = menus.map((q) =>
    q.single ? (
      <QueryBar.Menu key={q.name} qualifier={q.name} label={q.label!} single defaultOption="default" align="start" items={[{ value: 'default', label: q.single }, ...rowsOf(q, suffix)]} />
    ) : (
      <QueryBar.Menu key={q.name} qualifier={q.name} label={q.label!} align="start" items={rowsOf(q, suffix)} />
    ),
  )

  // The × at the field's right edge while it has text: it clears the whole query and keeps focus in the field. The design's
  // QueryInput types no `suffix`, but hands it on to its Input, which draws it inside the field.
  const clear =
    value !== '' ? (
      <Button
        svgOnly
        size="tiny"
        variant="tertiary"
        type="button"
        aria-label="Clear filter"
        title="Clear filter"
        onClick={() => {
          onChange('')
          document.getElementById(id)?.focus()
        }}
      >
        <X />
      </Button>
    ) : hinted && !phone ? (
      <Kbd small aria-hidden>
        /
      </Kbd>
    ) : undefined

  return (
    <QueryBar
      id={id}
      aria-label={label}
      size={phone ? 'large' : 'small'}
      placeholder={hint}
      value={value}
      onChange={onChange}
      qualifiers={qualifiers}
      {...{ suffix: clear, suffixStyling: false }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        // Escape clears a field with text and stays in it; in an empty one it leaves the field, as before.
        if (e.key === 'Escape' && value !== '') {
          e.preventDefault()
          onChange('')
        } else if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur()
      }}
    >
      {showMenus && items}
    </QueryBar>
  )
}
