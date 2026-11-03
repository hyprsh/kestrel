// "Top release groups" (a bar list of the files each group brought) and "Requests" (how many, how fast they were filled, how many
// are still searching, and who asked for what).
import { BarList } from '@hyprsh/design'
import { useState } from 'react'
import type { Stats } from '../api/stats'
import { plural } from '../format'
import { StatCard } from '../layout/StatCard'
import { placePath } from '../place'
import { span } from '../time'
import { Drill } from './Drill'
import { firstFive, ViewAllHere } from './Section'
import { rangeOf } from './statsText'

export function GroupsCard({ stats }: { stats: Stats }) {
  const groups = stats.release_groups
  const [all, setAll] = useState(false)
  const shown = all ? groups : firstFive(groups)
  return (
    <StatCard title="Top release groups" aside={<span className="label-13 text-gray-900">imported</span>}>
      {groups.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No files were imported in this range.</p>
      ) : (
        <BarList mono unit="files imported" aria-label="Top release groups" items={shown.map((g) => ({ label: g.name, value: g.files }))} />
      )}
      {groups.length > 5 && <ViewAllHere count={groups.length} open={all} onToggle={() => setAll(!all)} />}
    </StatCard>
  )
}

function Figure({ value, label, warn, to, open }: { value: string; label: string; warn?: boolean; to: string; open: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <Drill to={to} label={open} className={`heading-20 ${warn ? 'text-amber-900' : ''}`}>
        {value}
      </Drill>
      <span className="label-12 text-gray-900">{label}</span>
    </div>
  )
}

export function RequestsCard({ stats }: { stats: Stats }) {
  const r = stats.requests
  return (
    <StatCard title="Requests">
      <div className="grid grid-cols-3 gap-3">
        <Figure value={String(r.total)} label={stats.range === '30d' ? 'this month' : `in the last ${rangeOf(stats.range).short}`} to={placePath('requests')} open="Open every Request" />
        <Figure
          value={r.median_fulfil_seconds === null ? '—' : span(r.median_fulfil_seconds * 1000)}
          label="median to fulfil"
          to={placePath('requests', 'status:completed')}
          open="Open Completed Requests"
        />
        <Figure value={String(r.searching)} label="still searching" warn={r.searching > 0} to={placePath('requests', 'status:open')} open="Open the Open Requests" />
      </div>
      {r.requesters.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">Nobody asked for anything in this range.</p>
      ) : (
        <div className="label-13 flex flex-col gap-1.5">
          {r.requesters.map((q) => (
            <div key={`${q.source}-${q.name}`} className="flex justify-between gap-2">
              <Drill to={placePath('requests', `requester:${/\s/.test(q.name) ? `"${q.name}"` : q.name}`)} label={`Open ${q.name}'s Requests`} className="block truncate">
                {`${q.name} (${q.source})`}
              </Drill>
              <span className="whitespace-nowrap text-gray-900 tabular-nums">{`${plural(q.requests, 'request')} · ${q.done} done`}</span>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  )
}
