// chrome: layout
import type { MouseEvent, ReactNode } from 'react'

/** The list of links to a screen's sections, in the body of a SidePanel (Settings); it scrolls itself. */
export function JumpNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
      {children}
    </nav>
  )
}

/** A small heading over a run of JumpLinks ("Media"). */
export function JumpGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mb-1">
      <h2 className="label-12 px-2.5 pt-2.5 pb-1 text-gray-900">{title}</h2>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  )
}

/**
 * One link of a JumpNav. `current` marks the open one (aria-current); `warn` is a dot named "Needs attention"; `note` is
 * a line under the name (what a search matched).
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
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void
  current?: boolean
  warn?: boolean
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <li>
      <a
        href={href}
        onClick={onClick}
        aria-current={current ? 'true' : undefined}
        className={`label-14 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-gray-alpha-100 ${current ? 'bg-gray-alpha-200 font-medium text-gray-1000' : 'text-gray-1000'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{children}</span>
          {note && <span className="label-12 block truncate font-normal text-gray-900">{note}</span>}
        </span>
        {warn && <span role="img" aria-label="Needs attention" className="size-2 shrink-0 rounded-full bg-amber-700" />}
      </a>
    </li>
  )
}
