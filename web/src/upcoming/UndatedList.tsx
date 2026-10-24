import { Entity } from '@hyprsh/design'
import type { ReactNode } from 'react'

export function UndatedList({ children }: { children: ReactNode }) {
  return <Entity.List aria-label="No date yet">{children}</Entity.List>
}

export function UndatedRow({ index, sel, onSelect, left, right, children }: { index: number; sel: number; onSelect: () => void; left: ReactNode; right: ReactNode; children: ReactNode }) {
  return (
    <Entity as="button" current={index === sel} data-nav={`up-${index}`} onClick={onSelect} left={left} right={right}>
      {children}
    </Entity>
  )
}
