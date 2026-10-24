// chrome: layout
import { Button } from '@hyprsh/design'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

/** The header of a screen that opened over a list on a phone: a Back button and the screen's title. */
export function PhoneBackHeader({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-gray-alpha-400 py-1 pr-3 pl-1">
      <Button variant="tertiary" prefix={<ArrowLeft />} onClick={onBack}>
        Back
      </Button>
      <span className="label-14 min-w-0 flex-1 truncate">{children}</span>
    </div>
  )
}
