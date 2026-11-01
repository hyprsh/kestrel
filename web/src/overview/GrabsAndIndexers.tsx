// "Grabs per day" (stacked columns of imported and failed Grabs, with the sentence on what stands out) and "Indexers" (a bar of
// imported Grabs per indexer with its Hit rate, Answer time and failures, and the Best badge).
import { Badge } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { StatCard } from '../layout/StatCard'
import { Bar, BarHeader, BarRow, ChartTable, Columns, Legend, mark } from './charts'
import { answerText, dayText, grabsAlternative, grabsTotal, hitText, standOut } from './statsText'

export function GrabsCard({ stats }: { stats: Stats }) {
  const days = stats.grabs.per_day
  const sentence = standOut(stats)
  return (
    <StatCard
      title="Grabs per day"
      aside={
        <Legend
          items={[
            { label: 'Imported', className: mark.imported, value: String(stats.grabs.imported) },
            { label: 'Failed', className: mark.failed, value: String(stats.grabs.failed) },
          ]}
        />
      }
    >
      {grabsTotal(stats) === 0 ? (
        <p className="label-13 m-0 text-gray-900">No Grabs finished in this range.</p>
      ) : (
        <>
          <Columns
            height={120}
            alternative={grabsAlternative(stats)}
            columns={days.map((d) => ({
              key: d.day,
              title: dayText(d.day),
              parts: [
                { name: 'Imported', className: mark.imported, n: d.imported },
                { name: 'Failed', className: mark.failed, n: d.failed },
              ],
            }))}
            axis={days.length ? [dayText(days[0].day), dayText(days[Math.floor(days.length / 2)].day), 'Today'] : undefined}
          />
          <ChartTable caption="Grabs per day" head={['Day', 'Imported', 'Failed']} rows={days.map((d) => [dayText(d.day), d.imported, d.failed])} />
          {sentence && <p className="label-12 m-0 text-gray-900">{sentence}</p>}
        </>
      )}
    </StatCard>
  )
}

const WIDE = 'minmax(0,1fr) minmax(0,1.6fr) 3rem 3.5rem 3.5rem'
const NARROW = 'minmax(0,7rem) minmax(0,1fr) 2.5rem'

export function IndexersCard({ stats, phone }: { stats: Stats; phone: boolean }) {
  const ixs = stats.indexers
  const best = ixs.find((i) => i.id === stats.best_indexer_id)
  const most = Math.max(1, ...ixs.map((i) => i.imported))
  const columns = phone ? NARROW : WIDE
  const noRates = ixs.length > 0 && ixs.every((i) => i.hit_rate === null)
  return (
    <StatCard title="Indexers" aside={best && <Badge variant="blue" contrast="low" size="sm">{`Best: ${best.name}`}</Badge>}>
      {ixs.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No indexer was asked or grabbed from in this range.</p>
      ) : (
        <>
          <div className="flex flex-col">
            <BarHeader columns={columns}>
              <span>Indexer</span>
              <span>Grabs imported</span>
              <span className="text-right">Hit</span>
              {!phone && (
                <>
                  <span className="text-right">Answer</span>
                  <span className="text-right">Failed</span>
                </>
              )}
            </BarHeader>
            {ixs.map((i) => (
              <BarRow
                key={i.id}
                columns={columns}
                label={`${i.name}: ${i.imported} imported, ${i.failed} failed. Hit ${hitText(i.hit_rate)} of ${i.searches} searches, median answer ${answerText(i.median_answer_ms)}.`}
              >
                <span className="label-13 truncate font-medium">{i.name}</span>
                <Bar share={i.imported / most} figure={String(i.imported)} />
                <span className="label-13 text-right tabular-nums">{hitText(i.hit_rate)}</span>
                {!phone && (
                  <>
                    <span className="label-13 text-right text-gray-900 tabular-nums">{answerText(i.median_answer_ms)}</span>
                    <span className={`label-13 text-right tabular-nums ${i.failed > 2 ? 'text-red-900' : 'text-gray-900'}`}>{i.failed}</span>
                  </>
                )}
              </BarRow>
            ))}
          </div>
          <ChartTable
            caption="Indexers"
            head={['Indexer', 'Grabs imported', 'Grabs failed', 'Searches', 'Hit', 'Answer']}
            rows={ixs.map((i) => [i.name, i.imported, i.failed, i.searches, hitText(i.hit_rate), answerText(i.median_answer_ms)])}
          />
          <p className="label-12 m-0 text-gray-900">
            {noRates ? 'Hit and Answer fill in as searches run. ' : ''}
            Hit: searches that returned a release that fit. Answer: median response time.
            {best ? ' Best: the most imported Grabs among indexers with a Hit of at least 50%.' : ''}
          </p>
        </>
      )}
    </StatCard>
  )
}
