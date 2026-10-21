// Kestrel's background loops (ADR 0007) in words, by the server's loop name: one place for the
// Background jobs section, "Running now" and the top bar's indicator.

export type JobWords = {
  /** The loop's name in Background jobs: "Poll". */
  label: string
  /** What it does: "Follows the download client's progress". */
  does: string
  /** When its schedule has a busy cadence, when that applies: "while downloading". */
  busy?: string
  /** What it is doing while a pass runs, for "Running now": "Polling the download client". */
  running: string
  /** The same, short enough for the top bar: "Polling…". */
  short: string
}

const jobs: Record<string, JobWords> = {
  poll: {
    label: 'Poll',
    does: "Follows the download client's progress",
    busy: 'while downloading',
    running: 'Polling the download client',
    short: 'Polling…',
  },
  import: { label: 'Import', does: 'Imports finished downloads', running: 'Importing finished Grabs', short: 'Importing…' },
  search: {
    label: 'Search',
    does: 'Searches the Wanted Versions and those due an Upgrade',
    running: 'Searching for Wanted and Upgrades',
    short: 'Searching…',
  },
  health: { label: 'Health', does: 'Runs the health checks', running: 'Running the health checks', short: 'Checking health…' },
  rss: { label: 'RSS', does: "Checks indexers' new Releases", running: "Reading the indexers' RSS feeds", short: 'Reading RSS feeds…' },
  prune: {
    label: 'Prune',
    does: 'Deletes routine Log events older than 30 days and expired sessions',
    running: 'Pruning old Log entries',
    short: 'Pruning the Log…',
  },
  refresh: { label: 'Refresh', does: "Refreshes Titles' metadata", running: 'Refreshing metadata', short: 'Refreshing metadata…' },
  trash: {
    label: 'TRaSH',
    does: 'Checks for newer TRaSH Custom Formats and profiles',
    running: 'Updating the TRaSH snapshot',
    short: 'Updating TRaSH…',
  },
  updates: {
    label: 'Updates',
    does: 'Asks GitHub for a newer Kestrel release',
    running: 'Checking for a new Kestrel release',
    short: 'Checking for updates…',
  },
}

/** A loop's words; a loop this SPA does not know yet goes by its name. */
export function jobWords(name: string): JobWords {
  return jobs[name] ?? { label: name, does: '', running: name, short: `${name}…` }
}
