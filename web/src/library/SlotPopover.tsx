// The popover of one Slot's state that is not a file: what Wanted, downloading, not aired and not monitored say, with the
// actions that fit it (Search and Manual Search, View in Activity, Monitor). A file's is FileDetailsPopover.
import { Button, Popover } from '@hyprsh/design'
import type { ReactElement } from 'react'
import { StateDot } from './SlotChip'

export type SlotAction = { label: string; run: () => void; primary?: boolean }

export function SlotPopover({
  label,
  heading,
  state,
  text,
  lines = [],
  actions = [],
  trigger,
}: {
  /** The dialog's name: "S01E05 4K". */
  label: string
  /** "S01E05 · 4K". */
  heading: string
  state: string | null
  /** The state in words: "Wanted · 7 d", "40% · 13 min", "Not monitored". */
  text: string
  /** Quiet lines under it: the last search, the release. */
  lines?: string[]
  actions?: SlotAction[]
  trigger: ReactElement
}) {
  const tone = state === 'wanted' ? 'text-amber-900' : state === 'downloading' ? 'text-blue-900' : ''
  return (
    <Popover trigger={trigger} label={label} position="bottom-end" width={320}>
      {({ close }) => (
        <div
          // The grid's arrows and Space must not fire from in here; the popover keeps Escape and Tab.
          onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}
          className="flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-2">
            <StateDot state={state} />
            <p className="label-14-strong">{heading}</p>
          </div>
          <p className={`label-13 ${tone}`}>{text}</p>
          {lines.map((l) => (
            <p key={l} className="label-12 break-all text-gray-900">
              {l}
            </p>
          ))}
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.label}
                  variant={a.primary ? 'secondary' : 'tertiary'}
                  size="small"
                  onClick={() => {
                    close()
                    a.run()
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}
