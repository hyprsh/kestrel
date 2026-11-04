// The facts of a Release, a file in the library or a Grab, drawn the same way on every screen: label beside value, and why
// it scores what it does. Wide puts the facts and the points table side by side; narrow is one column, the Score a number
// followed by its Custom Formats as badges.
import { Badge, Link } from '@hyprsh/design'
import { Fragment, type ReactNode } from 'react'
import { usePhone } from '../responsive'
import { audioLine, qualityName, videoLine, type MediaFacts } from './media'
import { ageLong, breakdown, deltaText, heldScores, published, score, signed, type Cover, type CustomFormatMatch } from './releaseView'

/** What is known of a Release, file or Grab; every row the data lacks is left out, never guessed. */
export type Facts = MediaFacts & {
  /** The Size row's text. */
  size: string
  published_at?: string
  indexer?: string
  /** How many grabs the indexer counts; with `indexer`. */
  grabs?: number
  group?: string | null
  info_url?: string
  /** The Score; without one, the Custom Formats show alone. */
  score?: number | null
  formats?: CustomFormatMatch[]
}

export type Row = [label: string, value: ReactNode]

const tone = (n: number) => (n < 0 ? 'text-red-900' : 'text-green-900')

/** The rows of the facts list, in order: Quality, Video, Audio, Size, Published, Indexer, Group, the info link. */
function rowsOf(f: Facts): Row[] {
  const rows: Row[] = []
  if (f.quality) rows.push(['Quality', qualityName(f.quality)])
  const video = videoLine(f)
  if (video) rows.push(['Video', video])
  const audio = audioLine(f)
  if (audio) rows.push(['Audio', audio])
  rows.push(['Size', f.size])
  if (f.published_at) rows.push(['Published', `${published(f.published_at)}, ${ageLong(f.published_at)} ago`])
  if (f.indexer) rows.push(['Indexer', f.grabs ? `${f.indexer} · ${f.grabs.toLocaleString('en-US')} grabs` : f.indexer])
  if (f.group) rows.push(['Group', f.group])
  if (f.info_url && /^https?:\/\//i.test(f.info_url)) {
    rows.push([
      'Info',
      <Link key="info" href={f.info_url} target="_blank" rel="noreferrer noopener">
        Open on the indexer
      </Link>,
    ])
  }
  return rows
}

/** The Custom Formats of a Score as gray badges, "WEB Tier 01 +1,700"; the Profile's own points last. */
function Formats({ rows, rest }: { rows: CustomFormatMatch[]; rest: number }) {
  const all = rest !== 0 ? [...rows, { name: 'Profile and quality', points: rest }] : rows
  if (all.length === 0) return null
  return (
    <ul className="mt-1 flex list-none flex-wrap gap-1 p-0" aria-label="Custom Formats">
      {all.map((c) => (
        <li key={c.name} title={`${c.name}: ${c.points} points`}>
          <Badge variant="gray" contrast="low" size="sm">
            {`${c.name} ${signed(c.points)}`}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/**
 * The shared facts view. `lead` rows come before the standard ones (a Release's Covers), `extra` rows after them (a file's
 * Imported, Searched and Path); `replaces` are the files a Release replaces, whose held Score and the difference show beside
 * the Release's; `note` goes under the points. `layout` defaults to wide on a desktop and narrow on a phone.
 */
export function ReleaseFacts({
  facts,
  layout,
  lead = [],
  extra = [],
  replaces = [],
  note,
}: {
  facts: Facts
  layout?: 'wide' | 'narrow'
  lead?: Row[]
  extra?: Row[]
  replaces?: Cover[]
  note?: ReactNode
}) {
  const phone = usePhone()
  const narrow = (layout ?? (phone ? 'narrow' : 'wide')) === 'narrow'
  const rows = [...lead, ...rowsOf(facts), ...extra]
  const total = facts.score ?? null
  const { rows: points, rest } = breakdown(total ?? 0, facts.formats ?? [])
  const remainder = total === null ? 0 : rest
  const held = total === null ? '' : heldScores(replaces)
  const delta = total === null ? '' : deltaText({ score: total }, replaces)
  const hasPoints = total !== null || points.length > 0

  const list = (
    <dl className={`label-13 grid ${narrow ? 'grid-cols-[4.5rem_minmax(0,1fr)] gap-y-1' : 'grid-cols-[6rem_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5'}`}>
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-gray-900">{k}</dt>
          <dd className="m-0 min-w-0 break-words">{v}</dd>
        </Fragment>
      ))}
      {narrow && total !== null && (
        <>
          <dt className="text-gray-900">Score</dt>
          <dd className="m-0 min-w-0">
            <span className="hy-num">{score(total)}</span>
            <Formats rows={points} rest={remainder} />
          </dd>
          {held && (
            <>
              <dt className="text-gray-900">Held file</dt>
              <dd className="hy-num m-0">{delta ? `${held} · ${delta}` : held}</dd>
            </>
          )}
        </>
      )}
      {narrow && total === null && points.length > 0 && (
        <>
          <dt className="text-gray-900">Custom Formats</dt>
          <dd className="m-0 min-w-0">
            <Formats rows={points} rest={0} />
          </dd>
        </>
      )}
    </dl>
  )
  if (narrow || !hasPoints) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {list}
        {note && <span className="label-12 text-gray-900">{note}</span>}
      </div>
    )
  }
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {list}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="label-13 font-semibold">{total !== null ? `Why it scores ${score(total)}` : 'Custom Formats'}</span>
        <dl className="label-13 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
          {points.map((f) => (
            <div key={f.name} className="contents">
              <dt className="min-w-0 break-words">{f.name}</dt>
              <dd className={`hy-num m-0 text-right ${tone(f.points)}`}>{signed(f.points)}</dd>
            </div>
          ))}
          {remainder !== 0 && (
            <div className="contents">
              <dt>Profile and quality</dt>
              <dd className={`hy-num m-0 text-right ${tone(remainder)}`}>{signed(remainder)}</dd>
            </div>
          )}
          {total !== null && (
            <>
              <dt className="font-semibold">Score</dt>
              <dd className="hy-num m-0 text-right font-semibold">{score(total)}</dd>
            </>
          )}
          {held && (
            <>
              <dt>Held file</dt>
              <dd className="hy-num m-0 text-right">{held}</dd>
            </>
          )}
          {held && delta && (
            <>
              <dt>Difference</dt>
              <dd className="hy-num m-0 text-right">{delta}</dd>
            </>
          )}
        </dl>
        {note && <span className="label-12 text-gray-900">{note}</span>}
      </div>
    </div>
  )
}
