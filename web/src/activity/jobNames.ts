// Kestrel's background loops (ADR 0007) in words, by the server's loop name: one place for the
// Background jobs section, "Running now" and the top bar's indicator.

export type JobWords = {
  /** The loop's name in Background jobs: "Poll". */
  label: string
  /** What it does: "Follows the download client's progress". */
  does: string
  /** How often it runs. The cadences mirror internal/jobs (loops.go, daily.go, refresh.go). */
  every: string
  /** What it is doing while a pass runs, for "Running now": "Polling the download client". */
  running: string
  /** The same, short enough for the top bar: "Polling…". */
  short: string
}

const jobs: Record<string, JobWords> = {
  poll: {
    label: 'Poll',
    does: "Follows the download client's progress",
    every: 'Every 10 s while downloading, else 5 min',
    running: 'Polling the download client',
    short: 'Polling…',
  },
  import: { label: 'Import', does: 'Imports finished downloads', every: 'Every minute', running: 'Importing finished Grabs', short: 'Importing…' },
  search: {
    label: 'Search',
    does: 'Searches the Wanted Versions and those due an Upgrade',
    every: 'Every 5 min',
    running: 'Searching for Wanted and Upgrades',
    short: 'Searching…',
  },
  health: { label: 'Health', does: 'Runs the health checks', every: 'Every 5 min', running: 'Running the health checks', short: 'Checking health…' },
  rss: { label: 'RSS', does: "Checks indexers' new Releases", every: 'Every 15 min', running: "Reading the indexers' RSS feeds", short: 'Reading RSS feeds…' },
  prune: {
    label: 'Prune',
    does: 'Deletes routine Log events older than 30 days and expired sessions',
    every: 'Checked hourly, runs daily',
    running: 'Pruning old Log entries',
    short: 'Pruning the Log…',
  },
  refresh: { label: 'Refresh', does: "Refreshes Titles' metadata", every: 'Checked hourly, runs daily', running: 'Refreshing metadata', short: 'Refreshing metadata…' },
  trash: {
    label: 'TRaSH',
    does: 'Checks for newer TRaSH Custom Formats and profiles',
    every: 'Checked hourly, runs daily',
    running: 'Updating the TRaSH snapshot',
    short: 'Updating TRaSH…',
  },
  updates: {
    label: 'Updates',
    does: 'Asks GitHub for a newer Kestrel release',
    every: 'Checked hourly, runs daily',
    running: 'Checking for a new Kestrel release',
    short: 'Checking for updates…',
  },
}

/** A loop's words; a loop this SPA does not know yet goes by its name. */
export function jobWords(name: string): JobWords {
  return jobs[name] ?? { label: name, does: '', every: '', running: name, short: `${name}…` }
}
