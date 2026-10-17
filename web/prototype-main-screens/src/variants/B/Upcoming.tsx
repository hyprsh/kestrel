// PROTOTYPE, throwaway. Variant B · Posters: Upcoming as a "this week" poster strip, then a dated list. Not a calendar.
import { Clock } from 'lucide-react'
import { go } from '../../nav'
import { TODAY, daysBetween, titleById, upcoming, type UpcomingItem } from '../../mock'
import { Badge, Poster } from '../../ui'
import { PageHeader, SectionTitle, SlotPill, fmtDay, fmtDate, relDays } from './common'

export function Upcoming() {
  const week = upcoming.filter((u) => daysBetween(TODAY, u.date) <= 7)
  const later = upcoming.filter((u) => daysBetween(TODAY, u.date) > 7)
  const groups = later.reduce<Record<string, UpcomingItem[]>>((acc, u) => ((acc[u.date] ??= []).push(u), acc), {})

  return (
    <div>
      <PageHeader title="Upcoming" sub="Episodes and Movie releases expected soon. Dates and age ratings follow the release-date country, DE." />

      <section className="mb-12">
        <SectionTitle sub={`${fmtDate(TODAY)} – ${fmtDate('2026-10-24')}`}>This week</SectionTitle>
        <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-2">
          {week.map((u) => {
            const t = titleById(u.titleId)
            return (
              <button key={u.date + u.what} onClick={() => go('title', { id: u.titleId })} className="group w-44 shrink-0 text-left">
                <div className="relative">
                  <Poster title={t.title} hue={t.hue} className="w-full rounded-lg transition-shadow group-hover:shadow-lg" />
                  <div className="absolute top-2 left-2 rounded-md bg-background-100/90 px-2 py-1 text-center backdrop-blur">
                    <div className="text-[10px] font-medium tracking-wide text-gray-900 uppercase">{fmtDay(u.date).split(' ')[0].replace(',', '')}</div>
                    <div className="tabular text-lg leading-none font-semibold">{u.date.slice(8)}</div>
                  </div>
                </div>
                <div className="mt-2.5 truncate text-sm font-medium group-hover:underline">{u.label}</div>
                <div className="truncate text-[12px] text-gray-900">{u.what}</div>
                <div className="mt-1.5 flex items-center gap-1">
                  {u.slots.map((s) => <SlotPill key={s} slot={s} tone="gray" size="sm" />)}
                  <span className="ml-auto text-[12px] text-blue-900">{relDays(u.date)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <SectionTitle sub="Grouped by date">Later</SectionTitle>
        <div className="space-y-6">
          {Object.entries(groups).map(([date, items]) => (
            <div key={date} className="grid grid-cols-[160px_1fr] gap-6">
              <div className="pt-3">
                <div className="text-sm font-medium">{fmtDay(date)}</div>
                <div className="tabular text-[12px] text-gray-900">{date.slice(0, 4)} · {relDays(date)}</div>
              </div>
              <div className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
                {items.map((u) => {
                  const t = titleById(u.titleId)
                  return (
                    <button key={u.what} onClick={() => go('title', { id: u.titleId })} className="flex w-full items-center gap-4 px-4 py-3 text-left first:rounded-t-lg last:rounded-b-lg hover:bg-gray-alpha-100">
                      <Poster title={t.title} hue={t.hue} small className="w-9" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{u.label}</div>
                        <div className="truncate text-[12px] text-gray-900">{u.what}</div>
                      </div>
                      <div className="flex gap-1">{u.slots.map((s) => <SlotPill key={s} slot={s} tone="gray" size="sm" />)}</div>
                      {u.searchable ? (
                        <Badge tone="blue">Searches on release</Badge>
                      ) : (
                        <Badge><Clock size={11} /> Not searchable yet</Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
