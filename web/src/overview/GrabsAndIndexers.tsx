// "Grabs per day" (stacked columns of imported and failed Grabs, with the sentence on what stands out) and "Indexers" (a bar of
// imported Grabs per indexer with its Hit rate, Answer time and failures, and the Best badge).
import { Badge, BarList, ColumnChart } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { StatCard } from '../layout/StatCard'
import { placePath, useOpenPlace } from '../place'
import { Legend, mark } from './charts'
import { activityQuery } from './drillDown'
import { answerText, grabsAlternative, grabsTotal, hitText, periodText, periodWord, standOut } from './statsText'

export function GrabsCard({ stats }: { stats: Stats }) {
  const openPlace = useOpenPlace()
  const columns = stats.grabs.columns
  const sentence = standOut(stats)
  return (
    <StatCard
      title={`Grabs per ${periodWord(stats.range)}`}
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
          <ColumnChart
            height={120}
            legend={false}
            aria-label={grabsAlternative(stats)}
            series={[
              { key: 'imported', label: 'Imported', tone: 'success' },
              { key: 'failed', label: 'Failed', tone: 'error' },
            ]}
            data={columns.map((c) => ({ label: periodText(c.from, c.to), values: { imported: c.imported, failed: c.failed } }))}
            onOpen={(datum, seriesKey) => {
              const col = columns.find((c) => periodText(c.from, c.to) === datum.label)
              if (!col) return
              const stage = seriesKey ? (seriesKey === 'failed' ? 'failed' : 'done') : null
              openPlace(placePath('activity', activityQuery(col.from === col.to ? { day: col.from, stage } : { from: col.from, to: col.to, stage })))
            }}
          />
          {sentence && <p className="label-12 m-0 text-gray-900">{sentence}</p>}
        </>
      )}
    </StatCard>
  )
}

export function IndexersCard({ stats }: { stats: Stats }) {
  const openPlace = useOpenPlace()
  const ixs = stats.indexers
  const best = ixs.find((i) => i.id === stats.best_indexer_id)
  const noRates = ixs.length > 0 && ixs.every((i) => i.hit_rate === null)
  return (
    <StatCard
      title="Indexers"
      aside={
        best && (
          <span title="The most imported Grabs among indexers with a Hit of at least 50%">
            <Badge variant="green" contrast="low" size="sm">{`Best: ${best.name}`}</Badge>
          </span>
        )
      }
    >
      {ixs.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No indexer was asked or grabbed from in this range.</p>
      ) : (
        <>
          <BarList
            aria-label="Indexers"
            labelHeader="Indexer"
            valueHeader="Grabs imported"
            unit="imported"
            columns={[
              { key: 'hit', label: 'Hit', priority: 1, hideable: false },
              { key: 'answer', label: 'Answer', priority: 2 },
              { key: 'failed', label: 'Failed', priority: 3 },
            ]}
            items={ixs.map((i) => ({
              key: String(i.id),
              label: i.name,
              value: i.imported,
              columns: {
                hit: hitText(i.hit_rate),
                answer: answerText(i.median_answer_ms),
                failed: <span className={i.failed > 2 ? 'text-red-900' : undefined}>{i.failed}</span>,
              },
            }))}
            onOpen={(item) => openPlace(placePath('activity', activityQuery({ indexer: Number(item.key), from: stats.from, to: stats.to })))}
          />
          <p className="label-12 m-0 text-gray-900">
            {noRates ? 'Hit and Answer fill in as searches run. ' : ''}
            Hit: searches that returned a release that fit. Answer: median response time.
          </p>
        </>
      )}
    </StatCard>
  )
}
