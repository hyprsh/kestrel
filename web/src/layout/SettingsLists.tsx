// chrome: layout
import type { HTMLAttributes, ReactNode } from 'react'

/** The head of the indexer list: the column names over the rows, in the rows' grid. */
export function IndexerHead() {
  return (
    <div className="label-12 hidden grid-cols-[16px_minmax(0,1fr)_170px_90px_44px_32px] items-center gap-x-3.5 bg-background-200 px-4 py-2 text-gray-900 sm:grid">
      <span />
      <span>Indexer</span>
      <span>Status</span>
      <span>Last 30 days</span>
      <span>On</span>
      <span />
    </div>
  )
}

/**
 * One indexer of the list: the drag `handle`, `name` and `address`, `status`, its Grabs, the on/off switch and the
 * menu. A failing indexer's row is tinted red. On a phone the cells stack under the name.
 */
export function IndexerLine({
  failing,
  dragging,
  handle,
  name,
  address,
  status,
  grabs,
  toggle,
  menu,
  ...drag
}: {
  failing: boolean
  dragging: boolean
  handle: ReactNode
  name: ReactNode
  address: ReactNode
  status: ReactNode
  grabs: ReactNode
  toggle: ReactNode
  menu: ReactNode
} & Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>) {
  return (
    <div
      {...drag}
      className={`grid grid-cols-[16px_minmax(0,1fr)_auto_32px] items-center gap-x-3.5 gap-y-1 px-4 py-3 text-[13px] sm:grid-cols-[16px_minmax(0,1fr)_170px_90px_44px_32px] ${failing ? 'bg-red-100' : ''} ${dragging ? 'opacity-50' : ''}`}
    >
      {handle}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{name}</span>
        <span className="label-12-mono truncate text-gray-900">{address}</span>
      </div>
      <div className="col-start-2 row-start-2 min-w-0 sm:col-start-auto sm:row-start-auto">{status}</div>
      <span className="col-start-2 row-start-3 text-gray-900 sm:col-start-auto sm:row-start-auto">{grabs}</span>
      <span className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">{toggle}</span>
      <span className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto">{menu}</span>
    </div>
  )
}

/** The head of the Slot list: the column names over the rows, in the rows' grid. */
export function SlotHead() {
  return (
    <div className="label-12 hidden grid-cols-[16px_minmax(0,1fr)_minmax(0,1.4fr)_90px_80px_32px] items-center gap-x-3.5 bg-background-200 px-4 py-2 text-gray-900 sm:grid">
      <span />
      <span>Slot</span>
      <span>Default Profile</span>
      <span>Holds</span>
      <span>New Titles</span>
      <span />
    </div>
  )
}

/** One Slot of the list: the drag `handle`, its `label`, its `defaults`, the Versions it `holds`, the on-for-new-Titles `toggle` and the `menu`. On a phone the cells stack under the label. */
export function SlotLine({
  dragging,
  handle,
  label,
  defaults,
  holds,
  toggle,
  menu,
  ...drag
}: {
  dragging: boolean
  handle: ReactNode
  label: ReactNode
  defaults: ReactNode
  holds: ReactNode
  toggle: ReactNode
  menu: ReactNode
} & Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>) {
  return (
    <div
      {...drag}
      className={`grid grid-cols-[16px_minmax(0,1fr)_auto_32px] items-center gap-x-3.5 gap-y-1 px-4 py-3 text-[13px] sm:grid-cols-[16px_minmax(0,1fr)_minmax(0,1.4fr)_90px_80px_32px] ${dragging ? 'opacity-50' : ''}`}
    >
      {handle}
      <span className="font-semibold">{label}</span>
      <span className="col-start-2 row-start-2 min-w-0 text-gray-900 sm:col-start-auto sm:row-start-auto">{defaults}</span>
      <span className="col-start-2 row-start-3 text-gray-900 sm:col-start-auto sm:row-start-auto">{holds}</span>
      <span className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">{toggle}</span>
      <span className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto">{menu}</span>
    </div>
  )
}

/** The card of one Profile: name, what uses it and its action in a row, then the quality chips and a line of facts. `selected` marks the one open in the sheet. */
export function ProfileCard({ name, uses, action, selected, children }: { name: string; uses: ReactNode; action: ReactNode; selected: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={name}
      className={`flex flex-col gap-2.5 rounded-md px-4 py-3.5 shadow-border ${selected ? 'bg-gray-100 shadow-[0_0_0_1px_var(--gray-alpha-400),inset_2px_0_0_var(--gray-1000)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <h3 className="label-16 font-semibold">{name}</h3>
        <span className="label-13 min-w-0 flex-1 text-gray-900">{uses}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A quality of a Profile's ladder: `plain`, the `cutoff` dark, or `no` (not accepted) struck through. */
export function QualityChip({ tone = 'plain', title, children }: { tone?: 'plain' | 'cutoff' | 'no'; title?: string; children: ReactNode }) {
  const look = tone === 'cutoff' ? 'bg-gray-1000 text-background-100' : tone === 'no' ? 'text-gray-700 line-through shadow-[inset_0_0_0_1px_var(--gray-alpha-300)]' : 'bg-gray-100'
  return (
    <span title={title} data-tone={tone} className={`label-12 inline-flex h-[22px] items-center rounded px-2 whitespace-nowrap ${look}`}>
      {children}
    </span>
  )
}

export function QualityChips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1">{children}</div>
}

/** The facts line under a Profile's chips. */
export function ProfileFacts({ children }: { children: ReactNode }) {
  return <div className="label-13 flex flex-wrap gap-x-4 gap-y-1 text-gray-900">{children}</div>
}

/** The defaults line over the Profile cards: a name, what it holds and a button. */
export function DefaultsLine({ label, action, children }: { label: string; action: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md px-4 py-3.5 shadow-border">
      <h3 className="label-14 min-w-fit flex-1 whitespace-nowrap font-medium">{label}</h3>
      <div className="label-13 flex flex-wrap gap-x-6 gap-y-1">{children}</div>
      {action}
    </section>
  )
}

/** The checklist in the Profile sheet: rows of a quality with a tick. */
export function QualityList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col overflow-hidden rounded-md shadow-border [&>li:not(:last-child)]:border-b [&>li:not(:last-child)]:border-gray-alpha-200">{children}</ul>
}

export function QualityItem({
  cutoff,
  dragging,
  children,
  ...rest
}: { cutoff?: boolean; dragging?: boolean; children: ReactNode } & Pick<HTMLAttributes<HTMLLIElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>) {
  return (
    <li {...rest} className={`label-13 flex items-center gap-2.5 px-3 py-2 ${cutoff ? 'bg-gray-100' : ''} ${dragging ? 'opacity-50' : ''}`}>
      {children}
    </li>
  )
}
