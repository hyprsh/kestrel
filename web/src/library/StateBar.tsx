// chrome: domain-visual
// The bar of a Version's episodes by state, on its card in the Series table. Colour on the bar marks only what needs a look (Wanted,
// Long Missing, Downloading); what is Have is a quiet gray, and a complete Version draws a thin line instead of a bar.
export type BarPart = { key: string; n: number; color: string }

/** The bar colour of an episode state, in a Version's and a season's bar alike. */
export const barColor = {
  filled: 'bg-gray-500',
  wanted: 'bg-amber-700',
  longMissing: 'bg-red-700',
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
