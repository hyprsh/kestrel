// chrome: layout
import { useId, type ReactNode } from 'react'

/** A static block of a list screen: a small title with its count ("Downloading · 3") over its rows. */
export function SectionBlock({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="border-b border-gray-alpha-200">
      <h3 id={id} className="label-12-strong px-4 pt-4 pb-1 text-gray-900">{`${title} · ${count}`}</h3>
      {children}
    </section>
  )
}
