// A Title's History: a quiet line under the page ("History · 6 events, last: Grabbed 2 h ago") that opens the Title's
// recent events as plain sentences, with a way on to the Log. Routine events (searches, download progress) stay in the Log.
import { Button, Link, termText } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useEvents } from '../api/log'
import type { TitleDetail } from '../api/queries'
import { plural } from '../format'
import { sentence } from '../log/sentence'
import { causeText } from '../log/trigger'
import { placePath, useOpenPlace } from '../place'
import { ago, useNow } from '../time'

const SHOWN = 8

export function TitleHistory({ title }: { title: TitleDetail }) {
  const [open, setOpen] = useState(false)
  const now = useNow()
  const openPlace = useOpenPlace()
  const events = useEvents({ kinds: null, excludeKinds: [], slots: null, excludeSlots: [], titleIds: [title.id], excludeTitleIds: [], triggers: null, excludeTriggers: [], routine: false })
  const items = events.data ?? []
  if (items.length === 0) return null
  const last = items[0]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-label="History" className="mt-6">
      {/* On a phone the line wraps to two lines rather than cutting its last clause. */}
      <Button
        variant="tertiary"
        size="small"
        aria-expanded={open}
        prefix={<Chevron aria-hidden className="size-4" />}
        onClick={() => setOpen(!open)}
        className="h-auto min-h-8 whitespace-normal py-1 text-left"
      >
        <span className="line-clamp-2">{`History · ${plural(items.length, 'event')}, last: ${sentence(last).verb} ${ago(last.at, now)}`}</span>
      </Button>
      {open && (
        <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
          {items.slice(0, SHOWN).map((e) => {
            const s = sentence(e)
            const cause = causeText(e)
            return (
              <li key={e.id} className="label-13 flex min-w-0 gap-3">
                <span className="w-24 shrink-0 text-gray-900">{ago(e.at, now)}</span>
                <span
                  className={`min-w-0 truncate ${s.severity === 'error' ? 'text-red-900' : s.severity === 'warning' ? 'text-amber-900' : ''}`}
                  title={[`${s.verb} ${s.rest}`.trim(), cause].filter(Boolean).join(' · ')}
                >
                  <b className="font-medium">{s.verb}</b> <span className="text-gray-900">{s.rest}</span>
                  {cause && <span className="block truncate text-[12px] text-gray-900">{cause}</span>}
                </span>
              </li>
            )
          })}
          <li>
            <Link as="button" type="button" className="label-13" onClick={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))}>
              Show in Log
            </Link>
          </li>
        </ul>
      )}
    </section>
  )
}
