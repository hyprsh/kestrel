// chrome: layout
import { Icon, Skeleton } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { PosterSkeleton } from '../poster'
import { cx } from '../ui'

/**
 * The Overview's one card: a background-100 fill in a 1px border, and a header row of the title, a grey `meta` (a count or a
 * note), `aside` (a legend, a badge) and `link`, a link to the screen with all of it ("Activity", "Library"). `children` are
 * NowRow lists, a NowSub line, a NowEmpty line or a NowBody. `label` names the region when the title alone does not.
 */
export function NowCard({
  title,
  label,
  meta,
  aside,
  link,
  children,
}: {
  title: string
  label?: string
  meta?: ReactNode
  aside?: ReactNode
  link?: { label: string; onOpen: () => void }
  children: ReactNode
}) {
  return (
    <section aria-label={label ?? title} className="flex min-w-0 flex-col overflow-hidden rounded-md bg-background-100 shadow-border">
      <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3">
        <h2 className="heading-14 m-0">{title}</h2>
        {meta != null && meta !== false && meta !== '' && <span className="label-13 text-gray-900 tabular-nums">{meta}</span>}
        <span className="flex-1" />
        {aside}
        {link && (
          // Quiet, in grey like the meta: the design's Link is an inline link in the link colour, and this is the card's way on.
          <button
            type="button"
            aria-label={`Open ${link.label}`}
            onClick={link.onOpen}
            className="label-13 -my-1 inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-1 text-gray-900 hover:text-gray-1000 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-color)]"
          >
            {link.label}
            <Icon name="arrow-right" size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** A card's padded body, for a chart, figures or a few lines rather than rows. */
export function NowBody({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 pb-4">{children}</div>
}

/**
 * A quiet line under a card's header that opens a screen ("Wanted 15 · 12 long missing"): a clock, the text, a chevron, on a
 * faint tint, set off by a hairline. `navIndex` puts it in the j/k list, `current` marks it the selected one.
 */
export function NowSub({ navIndex, current, onSelect, onOpen, children }: { navIndex?: number; current?: boolean; onSelect?: () => void; onOpen: () => void; children: ReactNode }) {
  return (
    <div
      data-nav={navIndex !== undefined ? `ov-${navIndex}` : undefined}
      aria-current={current ? 'true' : undefined}
      onClick={onSelect}
      className={cx('border-t border-gray-alpha-200', current ? 'bg-gray-alpha-100' : 'bg-background-200')}
    >
      <button type="button" onClick={onOpen} className="label-13 flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-2 text-left text-gray-900 hover:text-gray-1000">
        <Icon name="clock" size={14} />
        <span className="min-w-0 flex-1 truncate tabular-nums">{children}</span>
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

/** The rows of a card. */
export function NowList({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none p-0">{children}</ul>
}

/**
 * One row, set off from the one above by a hairline: `lead` (a poster or icon) and `children` side by side, `right` (a menu, a
 * button) after them. With `onOpen` the lead and children are one button that opens what the row is about. `navIndex` puts it in
 * the j/k list, `current` marks it the selected one.
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
      <span className="flex min-w-0 flex-1 flex-col gap-1">{children}</span>
    </>
  )
  return (
    <li
      data-nav={navIndex !== undefined ? `ov-${navIndex}` : undefined}
      {...data}
      aria-current={current ? 'true' : undefined}
      onClick={onSelect}
      className={cx('flex items-center gap-2 border-t border-gray-alpha-200 px-4 py-2', current ? 'bg-gray-alpha-100' : 'hover:bg-gray-alpha-100')}
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

/** A row's second line, in grey: "Wanted 12 days · 11 Releases, none fit", "S04E06 · 2 h ago". */
export function NowLine({ children }: { children: ReactNode }) {
  return <span className="label-12 min-w-0 truncate text-gray-900">{children}</span>
}

/** The line a card shows when it has nothing. */
export function NowEmpty({ children }: { children: ReactNode }) {
  return <p className="label-13 m-0 border-t border-gray-alpha-200 px-4 py-5 text-center text-gray-900">{children}</p>
}

/** `count` rows of Skeleton blocks (a poster, two lines) where a card's rows will be; the list is `aria-busy`. */
export function NowSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <ul aria-busy="true" className="m-0 list-none p-0">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden className="flex items-center gap-3 border-t border-gray-alpha-200 px-4 py-2">
          <PosterSkeleton size="xs" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton width={`${50 + ((i * 17) % 30)}%`} height={14} />
            <Skeleton width={`${30 + ((i * 13) % 25)}%`} height={12} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A row's first line: the Title in bold, then what of it the row is about ("S05E09–E10", "46 episodes"). On a narrow card the
 * Title is what truncates; the second part keeps whole (up to 60% of the line).
 */
export function NowTitle({ name, what }: { name: string; what?: string }) {
  return (
    <span className="label-14 flex min-w-0 items-baseline gap-1.5">
      <b className="min-w-0 truncate font-medium">{name}</b>
      {what ? (
        <>
          {' '}
          <span className="label-13 max-w-[60%] shrink-0 truncate text-gray-900">{what}</span>
        </>
      ) : null}
    </span>
  )
}
