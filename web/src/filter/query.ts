// The filter language is the design system's (parseQuery, suggestQuery, QueryInput, QueryBar). What is
// left here is Kestrel's: the `kind:` qualifier the Title screens share and the key handling the
// filter fields add on top of QueryInput.
import type { KeyboardEvent } from 'react'
import type { Qualifier } from '@hyprsh/design'

/** `kind:` as the screens that list Titles take it: Movies or Series. */
export const kindQualifier = (excludable = false): Qualifier => ({ name: 'kind', help: 'Movies or Series', values: ['movie', 'series'], excludable })

/** For a filter field's onKeyDown: Enter and Escape leave the field (QueryInput never blurs itself) unless the handler took them. */
export function leaveField(e: KeyboardEvent<HTMLInputElement>) {
  if (!e.defaultPrevented && (e.key === 'Escape' || e.key === 'Enter')) e.currentTarget.blur()
}
