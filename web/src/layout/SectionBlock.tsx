// chrome: layout
import { useId, type ReactNode } from 'react'

/** A static block of a list screen: a `heading-16` title with its count ("Downloading · 3") over its rows. Leave `count` out while it is not known. */
export function SectionBlock({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="heading-16 mb-3">
        {count === undefined ? title : `${title} · ${count}`}
      </h3>
      {children}
    </section>
  )
}
