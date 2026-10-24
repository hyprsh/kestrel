// chrome: waiting hyprsh/design#36
// The "No date yet" list: an Entity.List whose rows carry the j/k cursor through NavRow. The design draws
// dividers only between direct Entity siblings, so the cursor rows' dividers are drawn here until the
// Entity `current` state lands (hyprsh/design#36).
import { Entity } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { NavRow } from '../NavRow'

export function UndatedList({ children }: { children: ReactNode }) {
  return (
    <Entity.List aria-label="No date yet" className="divide-y divide-gray-alpha-400">
      {children}
    </Entity.List>
  )
}

export function UndatedRow({ index, sel, onSelect, left, right, children }: { index: number; sel: number; onSelect: () => void; left: ReactNode; right: ReactNode; children: ReactNode }) {
  return (
    <NavRow scope="up" index={index} sel={sel} onSelect={onSelect}>
      <Entity as="div" left={left} right={right}>
        {children}
      </Entity>
    </NavRow>
  )
}
