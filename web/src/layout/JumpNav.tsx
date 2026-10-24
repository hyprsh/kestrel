// chrome: layout
import type { MouseEvent, ReactNode } from 'react'

/** A sticky column of links that jump to sections of the page beside it (desktop Settings). */
export function JumpNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="sticky top-0 w-48 shrink-0 self-start p-4">
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </nav>
  )
}

/** One link of a JumpNav. */
export function JumpLink({ href, onClick, children }: { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void; children: ReactNode }) {
  return (
    <li>
      <a href={href} onClick={onClick} className="label-14 block rounded-md px-2 py-1 text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000">
        {children}
      </a>
    </li>
  )
}
