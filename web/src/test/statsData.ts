import type { components } from '../api/schema.gen'

export type Stats = components['schemas']['Stats']

/** `n` days ending on 2026-10-31, oldest first, with imported and failed counts from `imported` and `failed` (zero past their end). */
export function grabDays(n: number, imported: number[] = [], failed: number[] = []): Stats['grabs']['per_day'] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 31 - (n - 1 - i)))
    return { day: d.toISOString().slice(0, 10), imported: imported[i] ?? 0, failed: failed[i] ?? 0 }
  })
}

const speedDays = (speeds: (number | null)[]) => speeds.map((s, i) => ({ day: new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0, 10), bytes_per_second: s === null ? null : s * 1_000_000 }))

/** A month at the Overview of a library of six Titles; `over` replaces whole sections. */
export function stats(over: Partial<Stats> = {}): Stats {
  const imported = Array.from({ length: 30 }, (_, i) => (i === 14 ? 7 : i % 3))
  const failed = Array.from({ length: 30 }, (_, i) => (i === 14 ? 1 : 0))
  return {
    range: '30d',
    from: '2026-10-02',
    to: '2026-10-31',
    library: { titles: 6, movies: 2, series: 3, bytes: 440 * 1024 ** 3 },
    wanted: { count: 9, long_missing: 1 },
    grabs: { imported: imported.reduce((a, b) => a + b, 0), failed: 1, per_day: grabDays(30, imported, failed) },
    time_to_fill: { median_seconds: 2 * 3600 + 14 * 60, previous_median_seconds: 3 * 3600 + 12 * 60, fills: 13 },
    indexers: [
      { id: 1, name: 'NZBgeek', imported: 34, failed: 1, searches: 50, hit_rate: 0.81, median_answer_ms: 600 },
      { id: 2, name: 'DrunkenSlug', imported: 19, failed: 0, searches: 40, hit_rate: 0.74, median_answer_ms: 900 },
      { id: 3, name: 'altHUB', imported: 9, failed: 4, searches: 30, hit_rate: 0.52, median_answer_ms: 2400 },
    ],
    best_indexer_id: 1,
    download_client: {
      name: 'SABnzbd',
      state: 'ok',
      completed: 64,
      failed: 4,
      avg_bytes_per_second: 24_000_000,
      median_download_seconds: 9 * 60,
      speed_per_day: speedDays([18, 22, 25, 12, 28, 31, 24, 20, 26, 27, 15, 23, 29, 24]),
    },
    quality: [
      { slot: 'standard', files: 100, remux_bluray: 22, web_dl: 64, webrip_or_lower: 14 },
      { slot: '4k', files: 60, remux_bluray: 10, web_dl: 48, webrip_or_lower: 2 },
    ],
    release_groups: [
      { name: 'NTb', files: 18 },
      { name: 'FLUX', files: 9 },
      { name: 'DON', files: 4 },
    ],
    requests: {
      total: 14,
      searching: 2,
      median_fulfil_seconds: 28 * 3600,
      requesters: [
        { name: 'Ellie', source: 'Plex', requests: 9, done: 8 },
        { name: 'Sam', source: 'Plex', requests: 5, done: 4 },
      ],
    },
    storage: {
      disks: [
        { path: '/media/tv', free_bytes: 1100 * 1024 ** 3, total_bytes: 4096 * 1024 ** 3 },
        { path: '/media/movies', free_bytes: 640 * 1024 ** 3, total_bytes: 2048 * 1024 ** 3 },
      ],
      free_bytes: 1740 * 1024 ** 3,
      total_bytes: 6144 * 1024 ** 3,
      growth_bytes_per_week: 45 * 1024 ** 3,
      series_share: 0.82,
      months_until_full: 9,
    },
    ...over,
  }
}

/** The nothing-yet answer a fresh install gives. */
export const emptyStats = (range: Stats['range'] = '30d'): Stats =>
  stats({
    range,
    library: { titles: 0, movies: 0, series: 0, bytes: 0 },
    wanted: { count: 0, long_missing: 0 },
    grabs: { imported: 0, failed: 0, per_day: grabDays(range === '7d' ? 7 : range === '90d' ? 90 : 30) },
    time_to_fill: { median_seconds: null, previous_median_seconds: null, fills: 0 },
    indexers: [],
    best_indexer_id: null,
    download_client: { name: null, state: 'none', completed: 0, failed: 0, avg_bytes_per_second: null, median_download_seconds: null, speed_per_day: [] },
    quality: [],
    release_groups: [],
    requests: { total: 0, searching: 0, median_fulfil_seconds: null, requesters: [] },
    storage: { disks: [], free_bytes: 0, total_bytes: 0, growth_bytes_per_week: null, series_share: null, months_until_full: null },
  })
