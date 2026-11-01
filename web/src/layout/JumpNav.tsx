// chrome: layout
import { ButtonLink } from '@hyprsh/design'
import type { MouseEvent, ReactNode } from 'react'
import { panelRowClass, panelRowsTitleClass } from './SidePanel'

/** The list of links to a screen's sections, as the `views` of a SidePanel (Settings): the same rows as a Views list. */
export function JumpNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {children}
    </nav>
  )
}

/** A small heading over a run of JumpLinks ("Connections"), in the style of the "Views" title. */
export function JumpGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <h2 className={`${panelRowsTitleClass} mt-1.5 first:mt-0`}>{title}</h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  )
}

/**
 * One link of a JumpNav, a row like a SidePanelView. `current` marks the open one (aria-current); `warn` is a dot named
 * "Needs attention" at the right edge; `note` is a line under the name (what a search matched).
 */
export function JumpLink({
  href,
  onClick,
  current = false,
  warn = false,
  note,
  children,
}: {
  href: string
  onClick: (event: MouseEvent<HTMLElement>) => void
  current?: boolean
  warn?: boolean
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <li>
      <ButtonLink
        href={href}
        onClick={onClick}
        variant={current ? 'secondary' : 'tertiary'}
        size="small"
        width="100%"
        aria-current={current ? 'true' : undefined}
        className={`${panelRowClass} ${note ? 'h-auto min-h-[34px] py-1' : ''}`}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate">{children}</span>
          {note && <span className="label-12 block truncate font-normal text-gray-900">{note}</span>}
        </span>
        {warn && <span role="img" aria-label="Needs attention" className="size-2 shrink-0 rounded-full bg-amber-700" />}
      </ButtonLink>
    </li>
  )
}
