// chrome: layout
import { Pill } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { cx } from '../ui'

/**
 * A card of the Overview's Happening now pair (Downloading, Searching): a heading with its count and a note at the far end,
 * `children` (NowRow lists, NowSub headings, a NowEmpty line) and a footer link. `label` names the region.
 */
export function NowCard({ label, count, aside, footer, children }: { label: string; count?: number; aside?: ReactNode; footer?: { label: string; onOpen: () => void }; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col rounded-md shadow-border">
      <div className="flex min-h-6 items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 className="heading-16 m-0">{label}</h2>
        {count != null && count > 0 && <span className="label-14 text-gray-900 tabular-nums">{count}</span>}
        <span className="flex-1" />
        {aside && <span className="label-13 text-gray-900 tabular-nums">{aside}</span>}
      </div>
      {children}
      {footer && (
        <div className="mt-auto border-t border-gray-alpha-200 px-4 py-2">
          <Pill onClick={footer.onOpen}>{footer.label}</Pill>
        </div>
      )}
    </section>
  )
}

/** A sub-heading inside a card ("Wanted 9"), set off by a rule; the count is amber. */
export function NowSub({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-t border-gray-alpha-200 px-4 pt-3 pb-1.5">
      <h3 className="heading-14 m-0">{title}</h3>
      <span className="label-13 text-amber-900 tabular-nums">{count}</span>
    </div>
  )
}

/** The rows of a card. */
export function NowList({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none p-0">{children}</ul>
}

/**
 * One row: `lead` (a poster or icon) and `children` side by side, `right` (a menu, a button) after them. With `onOpen` the
 * lead and children are one button that opens what the row is about. `navIndex` puts it in the j/k list, `current` marks it
 * the selected one.
 */
export function NowRow({
  navIndex,
  current,
  onSelect,
  onOpen,
  lead,
  right,
  children,
  ...data
}: {
  navIndex?: number
  current?: boolean
  onSelect?: () => void
  onOpen?: () => void
  lead?: ReactNode
  right?: ReactNode
  children: ReactNode
  [k: `data-${string}`]: boolean | undefined
}) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</span>
    </>
  )
  return (
    <li
      data-nav={navIndex !== undefined ? `ov-${navIndex}` : undefined}
      {...data}
      aria-current={current ? 'true' : undefined}
      onClick={onSelect}
      className={cx('flex items-center gap-2 border-t border-gray-alpha-200 px-4 py-2', current && 'bg-gray-alpha-100')}
    >
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left">
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {right}
    </li>
  )
}

/** The line a card shows when it has nothing. */
export function NowEmpty({ children }: { children: ReactNode }) {
  return <p className="label-14 m-0 border-t border-gray-alpha-200 px-4 py-6 text-center text-gray-900">{children}</p>
}

/**
 * A row's first line: the Title in bold, then what of it the row is about ("S05E09–E10", "46 episodes"). On a narrow card the
 * Title is what truncates; the second part keeps whole (up to 60% of the line).
 */
export function NowTitle({ name, what }: { name: string; what?: string }) {
  return (
    <span className="label-14 flex min-w-0 items-baseline gap-1">
      <b className="min-w-0 truncate font-medium">{name}</b>
      {what ? (
        <>
          {' '}
          <span className="max-w-[60%] shrink-0 truncate text-gray-900">{what}</span>
        </>
      ) : null}
    </span>
  )
}
