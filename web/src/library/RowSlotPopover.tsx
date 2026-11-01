// The popover of one Slot on a Library row: the Slot's name and Profile, where it stands in a line, what it holds (a Movie's
// file, a download's release, a Series' episode count) and a link that opens the Title at that Slot. A pointer that can hover
// opens it by hovering and a click goes straight to the Title; a touch screen opens it with a tap.
import { Button, Popover, Skeleton } from '@hyprsh/design'
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTitle } from '../api/queries'
import { StateDot } from '../ui/slotState'
import { size } from './bits'

export type RowSlotInfo = {
  /** "4K · UHD-2160p". */
  heading: string
  state: string | null
  /** The state in words: "Downloading 40% · 13 min left". */
  text: string
  /** Quiet lines under it: the file, the release, the episodes. */
  lines: string[]
}

const canHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches

/** Which Version's file the popover loads when it opens: the list rows carry none, a Movie's file is on its page. */
export type RowSlotFileOf = { titleId: number; versionId: number }

/** A Movie Version's file in one quiet line ("Bluray-1080p · H.265 · HDR10 · DDP 5.1 · 18.0 GB"), from the Title's page query, which is cached. */
function RowSlotFile({ titleId, versionId }: RowSlotFileOf) {
  const title = useTitle(titleId)
  if (title.isPending) return <Skeleton width="70%" height={14} />
  const f = title.data?.versions.find((v) => v.id === versionId)?.file
  if (!f) return null
  const audio = [f.audio_codec, f.audio_channels].filter(Boolean).join(' ')
  return <p className="label-12 break-words text-gray-900">{[f.quality, f.video_codec, f.hdr, audio, size(f.size)].filter(Boolean).join(' · ')}</p>
}

export function RowSlotPopover({ info, trigger, onOpen, file }: { info: RowSlotInfo; trigger: ReactElement; onOpen: () => void; file?: RowSlotFileOf }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Where focus stays while the popover opens on hover: the element that had it. Null when it opens from a tap or the keyboard, where it takes focus.
  const keep = useRef<HTMLElement | null>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const later = (to: boolean, ms: number, hover = false) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (to) keep.current = hover ? (document.activeElement as HTMLElement | null) : null
      setOpen(to)
    }, ms)
  }
  const tone = info.state === 'wanted' || info.state === 'upgrade' ? 'text-amber-900' : info.state === 'long_missing' ? 'text-red-900' : info.state === 'downloading' ? 'text-blue-900' : ''
  return (
    // The wrapper hears the pointer and the click, so a click on the chip opens the Title rather than the popover when a pointer can hover.
    <span
      className="inline-flex"
      onMouseEnter={() => canHover() && later(true, 150, true)}
      onMouseLeave={() => later(false, 120)}
      onClick={(e) => {
        e.stopPropagation()
        if (canHover()) {
          clearTimeout(timer.current)
          setOpen(false)
          onOpen()
        }
      }}
    >
      <Popover
        trigger={trigger}
        open={open}
        onOpenChange={(o) => {
          if (!o) setOpen(false)
          else if (!canHover()) {
            keep.current = null
            setOpen(true)
          }
        }}
        initialFocusRef={keep as RefObject<HTMLElement>}
        label={info.heading}
        position="bottom-start"
        width={300}
      >
        {({ close }) => (
          <div
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={() => later(false, 120)}
            // Arrows and Space must not reach the list; the popover keeps Escape and Tab.
            onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <StateDot state={info.state} />
              <p className="label-14-strong min-w-0 truncate">{info.heading}</p>
            </div>
            <p className={`label-13 ${tone}`}>{info.text}</p>
            {info.lines.map((l) => (
              <p key={l} className="label-12 break-words text-gray-900">
                {l}
              </p>
            ))}
            {file && <RowSlotFile {...file} />}
            <div>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => {
                  close()
                  onOpen()
                }}
              >
                Open
              </Button>
            </div>
          </div>
        )}
      </Popover>
    </span>
  )
}
