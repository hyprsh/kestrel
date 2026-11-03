// chrome: domain-visual
// One cell of the season table (VersionTable.tsx) that has something to do: a dot and a short text ("6 Wanted", "40%") that is a button.
// On a wide screen it opens a menu of that Version's actions for the season or episode; on a phone, where the cell shrinks to a dot and a
// count, the same actions open as a bottom sheet titled "Season 5 · 4K" with the state under it. A cell that has nothing to do is drawn
// as plain text (CellStatic).
import { Drawer, DrawerTitle, Entity, Menu, MenuButton, MenuContainer, MenuItem, MenuSection } from '@hyprsh/design'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'

/** What a cell shows: the state it is in, which sets the colour of its dot and text. */
export type CellKind = 'done' | 'wanted' | 'downloading' | 'out' | 'off'

/** One action of a cell's menu or sheet. `sub` is the line the sheet adds under the label. */
export type CellItem = { label: string; sub?: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean; reason?: string }

const dotClass: Record<Exclude<CellKind, 'done'>, string> = {
  wanted: 'bg-amber-700',
  downloading: 'bg-blue-700',
  out: 'border-[1.5px] border-gray-700',
  off: 'bg-gray-700',
}
const textClass: Record<Exclude<CellKind, 'done'>, string> = {
  wanted: 'text-amber-900',
  downloading: 'text-blue-900',
  out: 'text-gray-900',
  off: 'text-gray-700',
}

/** The cell's face on a wide screen: a quiet check when nothing is needed, else the dot and the text. */
function Face({ kind, text, size = 14 }: { kind: CellKind; text: string; size?: number }) {
  if (kind === 'done') return <Check aria-hidden width={size} height={size} className="shrink-0 text-gray-600" />
  return (
    <>
      <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${dotClass[kind]}`} />
      <span className={`label-13 whitespace-nowrap ${textClass[kind]}`}>{text}</span>
    </>
  )
}

/** The cell's face on a phone: a check, or the dot and the count. */
function PhoneFace({ kind, count }: { kind: CellKind; count: string }) {
  if (kind === 'done') return <Check aria-hidden width={14} height={14} className="shrink-0 text-gray-600" />
  return (
    <>
      <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${dotClass[kind]}`} />
      {count && <span className={`label-12 ${textClass[kind]}`}>{count}</span>}
    </>
  )
}

/** A cell with nothing to do: its face, not a button. `label` names it for a screen reader. */
export function CellStatic({ kind, text, count, label, phone }: { kind: CellKind; text: string; count: string; label: string; phone: boolean }) {
  return (
    <span role="img" aria-label={label} className={`flex items-center gap-2 ${phone ? 'justify-center gap-[3px]' : 'min-w-0 px-2'}`}>
      {phone ? <PhoneFace kind={kind} count={count} /> : <Face kind={kind} text={text} />}
    </span>
  )
}

/**
 * A cell with a menu. `title` heads the menu or sheet ("Season 5 · 4K"), `status` is the state in words ("6 Wanted") and `label` names the
 * button ("Season 5, 4K: 6 Wanted"). `text` is the cell's text on a wide screen and `count` its short form on a phone.
 */
export function CellButton({
  kind,
  text,
  count,
  label,
  title,
  status,
  items,
  phone,
  small,
  onFocus,
  tabIndex,
}: {
  kind: CellKind
  text: string
  count: string
  label: string
  title: string
  status: string
  items: CellItem[]
  phone: boolean
  /** An episode's cell: smaller, its ⋯ hover icon on show only while the row is hovered or focused. */
  small?: boolean
  onFocus?: () => void
  tabIndex?: number
}) {
  const [sheet, setSheet] = useState(false)
  if (phone) {
    return (
      <>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={label}
          data-cell=""
          tabIndex={tabIndex}
          onFocus={onFocus}
          onClick={() => setSheet(true)}
          className="flex h-full min-h-8 w-full cursor-pointer items-center justify-center gap-[3px] rounded-md focus-visible:outline-2 focus-visible:outline-(--focus-color)"
        >
          <PhoneFace kind={kind} count={count} />
        </button>
        <Drawer show={sheet} onDismiss={() => setSheet(false)} aria-label={title}>
          <div className="flex flex-col gap-1 px-2 pt-1 pb-6">
            <div className="flex items-center gap-2 px-3 pt-1 pb-2.5">
              {kind !== 'done' && <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass[kind]}`} />}
              <DrawerTitle className="heading-16">{title}</DrawerTitle>
              <span className={`label-13 ${kind === 'done' ? 'text-gray-900' : textClass[kind]}`}>{status}</span>
            </div>
            {items.map((m) => (
              <Entity
                key={m.label}
                as="button"
                disabled={m.disabled}
                left={<m.icon aria-hidden className="size-4 text-gray-900" />}
                onClick={() => {
                  setSheet(false)
                  m.onSelect()
                }}
              >
                <Entity.Content title={m.label} description={m.disabled && m.reason ? m.reason : m.sub} />
              </Entity>
            ))}
          </div>
        </Drawer>
      </>
    )
  }
  return (
    <MenuContainer position="bottom-start" className="min-w-0 max-w-full">
      <MenuButton
        type="unstyled"
        showChevron={false}
        aria-label={label}
        data-cell=""
        tabIndex={tabIndex}
        onFocus={onFocus}
        className={`flex max-w-full cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-gray-alpha-200 aria-expanded:bg-gray-alpha-200 h-8`}
      >
        <Face kind={kind} text={text} size={small ? 14 : 16} />
      </MenuButton>
      <Menu width={260}>
        <MenuSection title={`${title} · ${status}`}>
          {items.map((m) => (
            <MenuItem key={m.label} prefix={<m.icon aria-hidden className="size-4" />} disabled={m.disabled} description={m.disabled ? m.reason : undefined} onSelect={m.onSelect}>
              {m.label}
            </MenuItem>
          ))}
        </MenuSection>
      </Menu>
    </MenuContainer>
  )
}
