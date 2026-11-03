import { CommandMenuItem, KeyboardInput, Separator } from '@hyprsh/design'
import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Every row of the command menu is this one row: 52px tall (56px on a phone), a 36px leading slot (a poster crop for a Title, an icon
 * tile for a command or a choice), a title line with the year, a second line and a trail (text, a check or key hints).
 */
export type RowProps = {
  /** Names the row for code that reads the highlighted one (⌘↵). */
  id?: string
  poster?: ReactNode
  icon?: ReactNode
  title: ReactNode
  year?: string | number | null
  sub?: ReactNode
  /** Plain words at the end: "In Library", "On". `accent` colours it ("Changed"), `error` marks one that cannot be chosen. */
  trail?: string
  trailTone?: 'accent' | 'error'
  /** The current value of a choice list. */
  check?: boolean
  /** A chevron: the row opens a list or a page on top of this one (a phone shows it, as its lists have no key hints). */
  chevron?: boolean
  /** Key hints at the end, each one key (a sequence) or a modifier with its key. */
  keys?: { meta?: boolean; key: string }[]
  disabled?: boolean
  /** Whether the row opens something inside the menu (the usual case) rather than closing it. */
  closes?: boolean
  run: () => void
}

const tone = { accent: 'text-accent-900', error: 'text-red-900' }

export function Row({ id, poster, icon, title, year, sub, trail, trailTone, check, chevron, keys, disabled, closes, run }: RowProps) {
  const suffix =
    trail || check || chevron || keys ? (
      <>
        {trail && <span className={`label-12 whitespace-nowrap ${trailTone ? tone[trailTone] : 'text-gray-900'}`}>{trail}</span>}
        {check && <Check role="img" aria-label="Current" className="size-4 text-accent-900" />}
        {chevron && <ChevronRight aria-hidden className="size-4 text-gray-700" />}
        {keys?.map((k) => (
          <KeyboardInput key={k.key} small meta={k.meta}>
            {k.key}
          </KeyboardInput>
        ))}
      </>
    ) : undefined
  return (
    <CommandMenuItem
      className="h-13 gap-3 px-2.5 max-sm:h-14"
      prefix={
        poster ? (
          <span className="flex size-9 items-center justify-center">{poster}</span>
        ) : (
          // chrome-ok: the leading slot's icon tile, which no design component draws
          <span className="flex size-9 items-center justify-center rounded-lg bg-gray-200 text-gray-900 [&_svg]:size-4">{icon}</span>
        )
      }
      suffix={suffix}
      disabled={disabled}
      keepOpen={!closes}
      callback={run}
    >
      <span data-row={id ?? ''} className="flex min-w-0 flex-col gap-0.5">
        <span className="label-14 truncate">
          {title}
          {year ? (
            <>
              {' '}
              <span className="text-gray-900">{year}</span>
            </>
          ) : null}
        </span>{' '}
        {sub ? <span className="label-12 truncate text-gray-900">{sub}</span> : null}
      </span>
    </CommandMenuItem>
  )
}

/** The key hints under the list: what Enter, ⌘↵ and Esc do here. A touch screen has no keys to press, so a phone shows none. */
export function Hints({ hints }: { hints: { label: string; keys: { meta?: boolean; key: string }[] }[] }) {
  return (
    <div className="shrink-0 max-sm:hidden [@media(hover:none)]:hidden">
      <Separator />
      <div className="label-12 flex items-center gap-4 px-4 py-2.5 text-gray-900">
        {hints.map((h) => (
          <span key={h.label} className="flex items-center gap-1.5">
            {h.keys.map((k) => (
              <KeyboardInput key={k.key} small meta={k.meta}>
                {k.key}
              </KeyboardInput>
            ))}
            {h.label}
          </span>
        ))}
      </div>
    </div>
  )
}
