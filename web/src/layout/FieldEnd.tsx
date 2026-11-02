// chrome: layout
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Puts `children` (an icon button, such as a ×) at the end of the design field with the input `id`, inside its box. The design's
 * QueryInput takes no suffix of its own since v0.18 (it keeps the suffix for its `shortcut` key cap), so this adds to its box.
 */
export function FieldEnd({ id, children }: { id: string; children: ReactNode }) {
  const [box, setBox] = useState<Element | null>(null)
  useLayoutEffect(() => setBox(document.getElementById(id)?.closest('.hy-input') ?? null), [id])
  return box ? createPortal(<span className="flex items-center pr-1">{children}</span>, box) : null
}
