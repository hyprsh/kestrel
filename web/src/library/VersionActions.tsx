// chrome: domain-visual
// The action row of an opened Version: its next action, Manual Search and the More menu. On a phone the next action takes the
// full width and the others share a row beneath it, the way the Title's own bar stacks, so no label is cut. From the small
// breakpoint up it is one row with More at the end.
import type { ReactNode } from 'react'

export function VersionActions({ primary, secondary, more }: { primary?: ReactNode; secondary?: ReactNode; more: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch" data-version-actions>
      {primary && <div className="sm:contents max-sm:[&_button]:w-full">{primary}</div>}
      <div className="flex items-center gap-2 sm:contents max-sm:[&>*]:flex-1 max-sm:[&_button]:w-full">
        {secondary}
        <span className="flex-1 max-sm:hidden" />
        {more}
      </div>
    </div>
  )
}
