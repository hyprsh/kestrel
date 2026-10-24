// chrome: waiting hyprsh/design#34
import { Menu } from '@hyprsh/design'
import { MoreHorizontal } from 'lucide-react'

/**
 * The ⋯ button of a row menu in the episode grid: out of the Tab order, since the grid has a roving focus.
 * The menu hands focus back to this button when it closes; it passes it on to the row's cell, where the
 * keyboard was. It waits for DotsMenu to forward `tabIndex` and `onFocus` and to highlight itself while open.
 */
export function EpisodeRowMenuButton({ label }: { label: string }) {
  return (
    <Menu.Button
      svgOnly
      variant="tertiary"
      size="tiny"
      tabIndex={-1}
      aria-label={label}
      className="aria-expanded:bg-gray-alpha-200"
      onFocus={(e) => e.currentTarget.closest('[role="row"]')?.querySelector<HTMLElement>('[data-cell][tabindex="0"]')?.focus()}
    >
      <MoreHorizontal className="size-4" />
    </Menu.Button>
  )
}
