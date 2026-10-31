import { Badge } from '@hyprsh/design'
import { seasonName, type SeasonStanding } from './episodes'

/** A season's count on its tab: "5/8", amber while something in it is Wanted. */
export function TabCount({ standing }: { standing: SeasonStanding }) {
  return <span className={`label-12 hy-num ${standing.wanted > 0 ? 'text-amber-900' : 'text-gray-900'}`}>{`${standing.filled}/${standing.total}`}</span>
}

/** How the open season stands: "Season 2 · 5 of 8 filled · 1 downloading · 2 Wanted". */
export function SeasonSummary({ season, standing }: { season: number; standing: SeasonStanding }) {
  return (
    <span className="copy-13 hy-num min-w-0 flex-1 text-gray-900 max-sm:basis-full">
      {seasonName(season)} · {standing.filled} of {standing.total} filled
      {standing.downloading > 0 && ` · ${standing.downloading} downloading`}
      {standing.wanted > 0 && (
        <>
          {' · '}
          <Badge variant="amber" contrast="low" size="sm">
            {standing.wanted} Wanted
          </Badge>
        </>
      )}
    </span>
  )
}
