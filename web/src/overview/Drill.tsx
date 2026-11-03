// A figure or a line of an Overview card that opens the screen behind it: the layout's DrillLink around text in the card's own classes.
import type { ReactNode } from 'react'
import { DrillLink } from '../layout/DrillLink'

export function Drill({ to, label, className, children }: { to: string; label: string; className?: string; children: ReactNode }) {
  return (
    <DrillLink to={to} label={label}>
      <span className={className}>{children}</span>
    </DrillLink>
  )
}
