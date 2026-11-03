// chrome: domain-visual
// A one-line text that shows its full form while that fits and its short form when it does not, so a narrow list pane
// never cuts a status mid-word. The full text is the tooltip. A line that still overflows is cut with an ellipsis.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function FitLine({ text, short, className = '', ...rest }: { text: string; short?: string; className?: string } & Record<`data-${string}`, string | undefined>) {
  const ref = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  const width = useRef(0)
  const variable = short !== undefined && short !== text
  // A line is drawn full first: when that overflows, before it is painted, it turns short.
  useLayoutEffect(() => {
    const el = ref.current
    if (variable && fits && el && el.scrollWidth > el.clientWidth + 1) setFits(false)
  })
  // A pane that changes width gives the full form another chance.
  useEffect(() => {
    const el = ref.current
    if (!el || !variable || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (width.current !== 0 && w !== width.current) setFits(true)
      width.current = w
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [variable])
  return (
    <span ref={ref} title={variable ? text : undefined} className={`block truncate ${className}`} {...rest}>
      {variable && !fits ? short : text}
    </span>
  )
}
