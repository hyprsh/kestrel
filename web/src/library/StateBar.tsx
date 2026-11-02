// chrome: domain-visual
// What the Versions card and the Seasons rows of a Series page share, so the two cards sit on one grid: the columns of a row
// (chevron, lead, name, progress, chips, trailing figure) and the bar in the progress column. Colour on the bar marks only what
// needs a look (Wanted, Downloading); what is Have is a quiet gray, and a complete row draws a thin line instead of a bar.
import type { CSSProperties } from 'react'

/** How many chips a Series row shows before the rest fold into "+N". */
export const chipsShown = 4

const chipWidth = 92
const chipGap = 5

/** The width of the chips column for a Series with `slots` Slots: the same in every row of both cards, so the chips line up. */
export function chipColumn(slots: number): CSSProperties {
  const n = Math.max(1, slots > chipsShown ? chipsShown + 1 : slots)
  return { '--chips': `${n * chipWidth + (n - 1) * chipGap}px` } as CSSProperties
}

/** The columns of a row on a wide screen: chevron, lead (a season's bookmark), name, progress, chips, trailing figure. */
export const rowColumns = 'grid-cols-[16px_28px_112px_minmax(0,1fr)_var(--chips)_64px] h-14'
/** The same on a phone, where a row has its name and a line under it. */
export const rowColumnsPhone = 'grid-cols-[16px_minmax(0,1fr)_auto] min-h-14 py-2.5'

export type BarPart = { key: string; n: number; color: string }

/** The bar colour of an episode state, in a Version's and a season's bar alike. */
export const barColor = {
  filled: 'bg-gray-500',
  wanted: 'bg-amber-700',
  downloading: 'bg-blue-700',
  quiet: 'bg-gray-300',
} as const

/** A bar of episodes by state, in proportion. `complete` thins it to a line. */
export function StateBar({ parts, complete = false }: { parts: BarPart[]; complete?: boolean }) {
  return (
    <span aria-hidden data-complete={complete ? '' : undefined} className={`flex gap-0.5 overflow-hidden rounded-full bg-gray-100 ${complete ? 'h-0.5' : 'h-1.5'}`}>
      {parts
        .filter((p) => p.n > 0)
        .map((p) => (
          <span key={p.key} data-bar={p.key} style={{ flex: `${p.n} 0 0` }} className={p.color} />
        ))}
    </span>
  )
}
