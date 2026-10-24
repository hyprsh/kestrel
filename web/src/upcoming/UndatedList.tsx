import { Entity } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { NavRow } from '../NavRow'

export function UndatedList({ children }: { children: ReactNode }) {
  return (
    <Entity.List aria-label="No date yet">
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
