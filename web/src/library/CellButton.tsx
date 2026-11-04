// chrome: domain-visual
// One cell of the season table (VersionTable.tsx): a check, or a dot and a count ("6", "40%"), that is always a button.
// On a wide screen it opens a menu of that Version's actions for the season or episode; on a phone
// the same actions open as a bottom sheet titled "Season 5 · 4K" with the state under it. Every cell has at least Manual Search.
import { Drawer, DrawerTitle, Entity, Menu, MenuButton, MenuContainer, MenuItem, MenuSection } from '@hyprsh/design'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'

/** What a cell shows: the state it is in, which sets the colour of its dot and text. */
export type CellKind = 'done' | 'wanted' | 'downloading' | 'out' | 'off'

/** One action of a cell's menu or sheet. `sub` is the line the sheet adds under the label. */
export type CellItem = { label: string; sub?: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean; reason?: string }

export const dotClass: Record<Exclude<CellKind, 'done'>, string> = {
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

/** The cell's face: a quiet check when nothing is needed, else the dot and the count ("6", "2", "—", or "40%" on a wide screen). */
function Face({ kind, count, wide }: { kind: CellKind; count: string; wide: boolean }) {
  if (kind === 'done') return <Check aria-hidden width={wide ? 16 : 14} height={wide ? 16 : 14} className="shrink-0 text-gray-600" />
  return (
    <>
      <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${dotClass[kind]}`} />
      {count && <span className={`${wide ? 'label-14' : 'label-12'} ${textClass[kind]}`}>{count}</span>}
    </>
  )
}

/**
 * A cell with a menu. `title` heads the menu or sheet ("Season 5 · 4K"), `status` is the state in words ("6 Wanted") and `label` names the
 * button ("Season 5, 4K: 6 Wanted"). `count` is the text beside the dot.
 */
export function CellButton({
  kind,
  count,
  wide,
  label,
  title,
  status,
  items,
  phone,
  onFocus,
  tabIndex,
}: {
  kind: CellKind
  /** The count on a phone, a dot's only text. */
  count: string
  /** What a wide screen shows in its place, when it differs ("40%" for "40"). */
  wide?: string
  label: string
  title: string
  status: string
  items: CellItem[]
  phone: boolean
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
          <Face kind={kind} count={count} wide={false} />
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
        className={`flex h-8 max-w-full cursor-pointer items-center justify-center gap-1 rounded-md px-2 hover:bg-gray-alpha-200 aria-expanded:bg-gray-alpha-200`}
      >
        <Face kind={kind} count={wide ?? count} wide />
      </MenuButton>
      <Menu width={320}>
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
