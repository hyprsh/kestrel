// PROTOTYPE, throwaway. Variant A Upcoming: a list grouped Today / This week / Later, not a calendar.
import { TODAY, daysBetween, upcoming } from '../../mock'
import { go } from '../../nav'
import { Badge, Poster, cx } from '../../ui'
import { Page, PageHeader } from './shell'
import { fmtDay, relDays, useStore } from './store'

export function UpcomingScreen() {
  const { titleById } = useStore()
  const groups = [
    { label: 'Today', items: upcoming.filter((u) => u.date === TODAY) },
    { label: 'This week', items: upcoming.filter((u) => daysBetween(TODAY, u.date) > 0 && daysBetween(TODAY, u.date) <= 7) },
    { label: 'Later', items: upcoming.filter((u) => daysBetween(TODAY, u.date) > 7) },
  ]
  return (
    <>
      <PageHeader title="Upcoming" sub="Episodes and movie releases expected soon, for monitored Titles. Searching starts on its own when each becomes searchable." />
      <Page className="max-w-[1000px]">
        <div className="flex flex-col gap-8">
          {groups.map((g) => {
            const days = [...new Set(g.items.map((i) => i.date))]
            return (
              <section key={g.label}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-base font-semibold tracking-tight">{g.label}</h2>
                  <span className="tabular text-[13px] text-gray-900">{g.items.length}</span>
                </div>
                {g.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-alpha-400 px-4 py-4 text-[13px] text-gray-900">Nothing expected {g.label.toLowerCase()}.</div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-alpha-400 bg-background-100">
                    {days.map((d, di) => (
                      <div key={d} className={cx('grid grid-cols-[150px_1fr]', di > 0 && 'border-t border-gray-alpha-400')}>
                        <div className="tabular border-r border-gray-alpha-400 bg-background-200 px-4 py-3">
                          <div className="text-[13px] font-medium">{fmtDay(d)}</div>
                          <div className="text-[12px] text-gray-900">{relDays(d)}</div>
                        </div>
                        <div className="divide-y divide-gray-alpha-400">
                          {g.items
                            .filter((i) => i.date === d)
                            .map((u, i) => {
                              const t = titleById(u.titleId)!
                              return (
                                <button key={i} onClick={() => go('title', { id: t.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-alpha-100">
                                  <Poster title={t.title} hue={t.hue} small className="w-7 rounded" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-[13px]">
                                      <span className="font-medium">{u.label}</span>
                                      <Badge tone={t.kind === 'movie' ? 'gray' : 'purple'}>{t.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
                                    </div>
                                    <div className="text-[12px] text-gray-900">{u.what}</div>
                                  </div>
                                  <div className="flex gap-1">
                                    {u.slots.map((s) => (
                                      <span key={s} className="rounded-md border border-gray-alpha-400 px-1.5 font-mono text-[11px] leading-5">
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="w-32 text-right">{u.searchable ? <Badge tone="blue">Searched on release</Badge> : <Badge>Not searchable</Badge>}</div>
                                </button>
                              )
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </Page>
    </>
  )
}
