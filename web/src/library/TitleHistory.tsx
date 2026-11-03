// chrome: domain-visual
// A Title's History: one collapsed row under the Versions ("History", "17 events · last: Grabbed S05E09–E10 for Standard, 4 h ago", and
// an Open in Log link) that opens in place to the newest events (icon, what, why · who, when) with a way on to the Log. Routine events
// (searches, download progress) stay in the Log.
import { Link, termText } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useEvents } from '../api/log'
import type { TitleDetail } from '../api/queries'
import { plural } from '../format'
import { icons } from '../log/EventList'
import { sentence } from '../log/sentence'
import { causeText } from '../log/trigger'
import { placePath, useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { ago, useNow } from '../time'

const SHOWN = 8

const tone = { plain: 'text-gray-900', warning: 'text-amber-900', error: 'text-red-900' } as const

export function TitleHistory({ title }: { title: TitleDetail }) {
  const [open, setOpen] = useState(false)
  const now = useNow()
  const phone = usePhone()
  const openPlace = useOpenPlace()
  const events = useEvents({ kinds: null, excludeKinds: [], slots: null, excludeSlots: [], titleIds: [title.id], excludeTitleIds: [], triggers: null, excludeTriggers: [], routine: false })
  const items = events.data ?? []
  if (items.length === 0) return null
  const last = sentence(items[0])
  const Chevron = open ? ChevronDown : ChevronRight
  const log = () => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))
  const summary = `${plural(items.length, 'event')} · last: ${[last.verb, last.rest].filter(Boolean).join(' ')}, ${ago(items[0].at, now)}`
  return (
    <section aria-label="History" className="mt-6">
      <div className="overflow-hidden rounded-lg shadow-border">
        <div className="flex items-center gap-2 pr-4 max-sm:pr-3">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`History · ${summary}`}
            onClick={() => setOpen(!open)}
            className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3.5 px-4 py-2 text-left hover:bg-gray-alpha-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-color) max-sm:gap-2.5 max-sm:px-3"
          >
            <Chevron aria-hidden className="size-4 shrink-0 text-gray-900" />
            <span className="flex min-w-0 flex-1 items-baseline gap-3.5 max-sm:flex-col max-sm:gap-0.5">
              <span className="heading-16 max-sm:heading-14">History</span>
              <span className="label-13 min-w-0 truncate text-gray-900 max-sm:label-12">{phone ? `${plural(items.length, 'event')} · newest first` : summary}</span>
            </span>
          </button>
          {!open && (
            <Link as="button" type="button" className="label-13 shrink-0 max-sm:hidden" onClick={log}>
              Open in Log
            </Link>
          )}
        </div>
        {open && (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.slice(0, SHOWN).map((e) => {
              const s = sentence(e)
              const cause = causeText(e)
              const Icon = icons[s.icon]
              const what = [s.verb, s.rest].filter(Boolean).join(' ')
              return (
                <li key={e.id} className="flex items-center gap-3.5 border-t border-gray-alpha-200 px-4 py-2.5 max-sm:gap-2.5 max-sm:px-3 max-sm:py-2">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-200 max-sm:size-7 ${tone[s.severity]}`}>
                    <Icon aria-hidden className="size-4 max-sm:size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5" title={[what, cause].filter(Boolean).join(' · ')}>
                    <span className={`label-14 truncate max-sm:label-13 ${s.severity === 'error' ? 'text-red-900' : s.severity === 'warning' ? 'text-amber-900' : ''}`}>{what}</span>
                    <span className="label-12 truncate text-gray-900">{phone ? [ago(e.at, now), cause].filter(Boolean).join(' · ') : cause}</span>
                  </span>
                  <span className="label-13 shrink-0 whitespace-nowrap text-gray-900 max-sm:hidden">{ago(e.at, now)}</span>
                </li>
              )
            })}
            <li className="border-t border-gray-alpha-200 px-4 py-2.5 max-sm:px-3 max-sm:py-2">
              <Link as="button" type="button" className="label-13" onClick={log}>
                {phone ? 'Open in Log' : `Show all ${plural(items.length, 'event')} in the Log`}
              </Link>
            </li>
          </ul>
        )}
      </div>
    </section>
  )
}
