// "Top release groups" (a bar list of the files each group brought) and "Requests" (how many, how fast they were filled, how many
// are still searching, and who asked for what).
import type { Stats } from '../api/stats'
import { plural } from '../format'
import { StatCard } from '../layout/StatCard'
import { span } from '../time'
import { Bar, BarRow, ChartTable } from './charts'
import { rangeOf } from './statsText'

const GROUP_COLUMNS = 'minmax(0,5.5rem) minmax(0,1fr)'

export function GroupsCard({ stats }: { stats: Stats }) {
  const groups = stats.release_groups
  const most = Math.max(1, ...groups.map((g) => g.files))
  return (
    <StatCard title="Top release groups" aside={<span className="label-13 text-gray-900">files imported</span>}>
      {groups.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No files were imported in this range.</p>
      ) : (
        <>
          <div className="flex flex-col">
            {groups.map((g) => (
              <BarRow key={g.name} columns={GROUP_COLUMNS} label={`${g.name}: ${plural(g.files, 'file')} imported`}>
                <span className="label-13-mono truncate">{g.name}</span>
                <Bar share={g.files / most} figure={String(g.files)} />
              </BarRow>
            ))}
          </div>
          <ChartTable caption="Top release groups" head={['Release group', 'Files imported']} rows={groups.map((g) => [g.name, g.files])} />
        </>
      )}
    </StatCard>
  )
}

function Figure({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={`heading-20 ${warn ? 'text-amber-900' : ''}`}>{value}</span>
      <span className="label-12 text-gray-900">{label}</span>
    </div>
  )
}

export function RequestsCard({ stats }: { stats: Stats }) {
  const r = stats.requests
  return (
    <StatCard title="Requests">
      <div className="grid grid-cols-3 gap-3">
        <Figure value={String(r.total)} label={stats.range === '30d' ? 'this month' : `in the last ${rangeOf(stats.range).short}`} />
        <Figure value={r.median_fulfil_seconds === null ? '—' : span(r.median_fulfil_seconds * 1000)} label="median to fulfil" />
        <Figure value={String(r.searching)} label="still searching" warn={r.searching > 0} />
      </div>
      {r.requesters.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">Nobody asked for anything in this range.</p>
      ) : (
        <div className="label-13 flex flex-col gap-1.5">
          {r.requesters.map((q) => (
            <div key={`${q.source}-${q.name}`} className="flex justify-between gap-2">
              <span className="truncate">{`${q.name} (${q.source})`}</span>
              <span className="whitespace-nowrap text-gray-900 tabular-nums">{`${plural(q.requests, 'request')} · ${q.done} done`}</span>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  )
}
