// Where the Overview's cards lead: Activity's filter text for a day's Grabs or an indexer's, kept in the address bar as `?q=`.
// The Grabs the Overview counts are the ones that finished in a UTC day, so the filter names UTC days too.

/** The Activity filter for Grabs that finished on `day`, or in `from` to `to`, from `indexer` (an id), and in the `stage` Done or Failed. */
export function activityQuery(f: { day?: string; from?: string; to?: string; indexer?: number; stage?: 'done' | 'failed' | null }): string {
  return [f.stage && `stage:${f.stage}`, f.day && `day:${f.day}`, f.from && `from:${f.from}`, f.to && `to:${f.to}`, f.indexer !== undefined && `indexer:${f.indexer}`].filter(Boolean).join(' ')
}
