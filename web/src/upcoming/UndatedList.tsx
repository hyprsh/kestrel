import { Entity } from '@hyprsh/design'
import { RowList, stackedRow, stackedRight } from '../layout/RowList'
import type { ReactNode } from 'react'

export function UndatedList({ children }: { children: ReactNode }) {
  return <RowList aria-label="No date yet">{children}</RowList>
}

export function UndatedRow({ index, sel, onSelect, left, right, children }: { index: number; sel: number; onSelect: () => void; left: ReactNode; right: ReactNode; children: ReactNode }) {
  return (
    <Entity as="button" current={index === sel} data-nav={`up-${index}`} onClick={onSelect} className={stackedRow} rightClassName={stackedRight} left={left} right={right}>
      {children}
    </Entity>
  )
}
