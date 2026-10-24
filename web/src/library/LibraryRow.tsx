// chrome: waiting hyprsh/design#36
// The Library list's j/k cursor row. It waits for Entity `current` (ADR 0017): until then the cursor tint is
// drawn here, so the one spot that still carries chrome is this file.
import type { ReactNode } from 'react'
import { cx } from '../ui'

export function LibraryRow({
  id,
  index,
  selected,
  phone,
  onClick,
  children,
}: {
  id: number
  index: number
  selected: boolean
  phone: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div
      id={`title-${id}`}
      role="option"
      aria-selected={selected}
      data-nav={`lib-${index}`}
      onClick={onClick}
      className={cx('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 max-sm:min-h-12', selected && !phone ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')}
    >
      {children}
    </div>
  )
}
