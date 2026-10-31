import { type SeasonStanding } from './episodes'

/** A season's fill count in the season menu: "5/8", amber while something in it is Wanted. */
export function SeasonCount({ standing }: { standing: SeasonStanding }) {
  return <span className={`hy-num ${standing.wanted > 0 ? 'text-amber-900' : ''}`}>{`${standing.filled}/${standing.total}`}</span>
}

/** How the open season stands, on one line that truncates as a whole: "5 of 8 filled · 1 downloading · 2 Wanted". */
export function SeasonSummary({ standing }: { standing: SeasonStanding }) {
  return (
    <span className="copy-13 hy-num min-w-0 truncate whitespace-nowrap text-gray-900">
      {standing.filled} of {standing.total} filled
      {standing.downloading > 0 && ` · ${standing.downloading} downloading`}
      {standing.wanted > 0 && (
        <>
          {' · '}
          <span className="text-amber-900">{standing.wanted} Wanted</span>
        </>
      )}
    </span>
  )
}
