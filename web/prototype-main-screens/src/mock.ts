// PROTOTYPE, throwaway. In-memory mock data for the main-screens prototype (wayfinder ticket #13).
// Terms follow GLOSSARY.md: Title, Movie, Series, Slot, Profile, Version, Release, Grab, Import, Blocklist, Request, Upcoming.
// "Today" is 2026-10-17. The household's Primary Language is German.

export type Kind = 'movie' | 'series'
export type Slot = 'SD' | 'HD' | 'UHD'
export const SLOTS: Slot[] = ['SD', 'HD', 'UHD']

export const TODAY = '2026-10-17'
export const PRIMARY_LANGUAGE = 'German'

export type Profile = {
  id: string
  name: string
  slot: Slot
  requires: 'primary' | 'original'
  kids?: boolean
  backing: string // TRaSH profile it is backed by or derived from
  resolution: string
  enabled: boolean
  defaultFor: Kind[]
  englishFallback?: boolean // Primary-Language Profiles only
}

export const profiles: Profile[] = [
  { id: 'sd', name: 'SD', slot: 'SD', requires: 'primary', backing: 'derived from [German] HD Bluray + WEB', resolution: '≤ 576p', enabled: true, defaultFor: [], englishFallback: false },
  { id: 'sd-orig', name: 'SD Original', slot: 'SD', requires: 'original', backing: 'derived from HD Bluray + WEB', resolution: '≤ 576p', enabled: true, defaultFor: [] },
  { id: 'hd', name: 'HD', slot: 'HD', requires: 'primary', backing: '[German] HD Bluray + WEB', resolution: '720p–1080p', enabled: true, defaultFor: ['movie', 'series'], englishFallback: false },
  { id: 'hd-orig', name: 'HD Original', slot: 'HD', requires: 'original', backing: 'HD Bluray + WEB / WEB-1080p', resolution: '720p–1080p', enabled: true, defaultFor: [] },
  { id: 'kids', name: 'Kids', slot: 'HD', requires: 'primary', kids: true, backing: 'derived from [German] HD Bluray + WEB, SD added', resolution: 'SD–1080p', enabled: true, defaultFor: [], englishFallback: true },
  { id: 'kids-orig', name: 'Kids Original', slot: 'HD', requires: 'original', kids: true, backing: 'derived from HD Bluray + WEB, SD added', resolution: 'SD–1080p', enabled: true, defaultFor: [] },
  { id: 'uhd', name: 'UHD', slot: 'UHD', requires: 'primary', backing: '[German] UHD Bluray + WEB', resolution: '2160p', enabled: true, defaultFor: [], englishFallback: false },
  { id: 'uhd-orig', name: 'UHD Original', slot: 'UHD', requires: 'original', backing: 'UHD Bluray + WEB / WEB-2160p', resolution: '2160p', enabled: true, defaultFor: [] },
]
export const profileById = (id: string) => profiles.find((p) => p.id === id)!

export type FileInfo = {
  path: string
  quality: string // e.g. Bluray-1080p
  size: string
  score: number
  languages: string[] // probed audio
  group: string
}

export type VersionState = 'available' | 'missing' | 'downloading' | 'unreleased'

export type Version = {
  slot: Slot
  profileId: string
  state: VersionState
  file?: FileInfo
  missingSince?: string // release date it became searchable; 90+ days → "long missing"
  lastSearched?: string
  progress?: number // 0–100 when downloading
  episodesHave?: number // Series only
  episodesWanted?: number // Series only
}

export type Episode = {
  number: number
  title: string
  airDate: string
  monitored: boolean
  files: Partial<Record<Slot, { quality: string; score: number; languages: string[] } | 'missing' | 'downloading' | 'unreleased'>>
}

export type Season = { number: number; monitored: boolean; episodes: Episode[] }

export type Title = {
  id: string
  kind: Kind
  title: string // English
  primaryTitle?: string // Primary-Language (German) title, shown as a secondary line
  year: number
  tmdbId: number
  tvdbId?: number
  imdbId: string
  overview: string
  runtime: string
  certification: string // release-date country rating (FSK)
  originalLanguage: string
  genres: string[]
  status: string // Released / In cinemas / Continuing / Ended / Announced
  monitoring: 'All' | 'Future only' | 'None' // Series; Movies: All = monitored
  releaseDates?: { theatrical?: string; digital?: string; physical?: string }
  nextAiring?: string
  versions: Version[]
  seasons?: Season[]
  request?: { by: string; source: string; at: string; slots: Slot[] }
  folder: string
  hue: number // placeholder poster colour
}

const ep = (number: number, title: string, airDate: string, files: Episode['files'], monitored = true): Episode => ({ number, title, airDate, monitored, files })
const de = ['German', 'English']
const f = (quality: string, score: number, languages = de) => ({ quality, score, languages })

export const titles: Title[] = [
  {
    id: 'dune2', kind: 'movie', title: 'Dune: Part Two', primaryTitle: 'Dune: Part Two', year: 2024, tmdbId: 693134, imdbId: 'tt15239678',
    overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    runtime: '2h 47m', certification: 'FSK 12', originalLanguage: 'English', genres: ['Science Fiction', 'Adventure'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2024-02-29', digital: '2024-04-16', physical: '2024-05-30' },
    folder: '/data/media/movies/Dune Part Two (2024) {tmdb-693134}', hue: 32,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'available', lastSearched: '2026-09-30', file: { path: 'Dune Part Two (2024) {tmdb-693134} - [HD][Bluray-1080p][German DL][DTS-HD MA 5.1][x264]-DETAiLS.mkv', quality: 'Bluray-1080p', size: '14.2 GB', score: 13450, languages: de, group: 'DETAiLS' } },
      { slot: 'UHD', profileId: 'uhd', state: 'available', lastSearched: '2026-09-30', file: { path: 'Dune Part Two (2024) {tmdb-693134} - [UHD][Bluray-2160p][German DL][DV HDR10][TrueHD Atmos 7.1][x265]-W4K.mkv', quality: 'Bluray-2160p', size: '61.8 GB', score: 15200, languages: de, group: 'W4K' } },
    ],
  },
  {
    id: 'oppenheimer', kind: 'movie', title: 'Oppenheimer', year: 2023, tmdbId: 872585, imdbId: 'tt15398776',
    overview: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II.',
    runtime: '3h 01m', certification: 'FSK 12', originalLanguage: 'English', genres: ['Drama', 'History'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2023-07-20', digital: '2023-11-21', physical: '2023-11-23' },
    folder: '/data/media/movies/Oppenheimer (2023) {tmdb-872585}', hue: 12,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'available', lastSearched: '2026-10-02', file: { path: 'Oppenheimer (2023) {tmdb-872585} - [HD][Bluray-1080p][German DL][DTS 5.1][x264]-SAUERKRAUT.mkv', quality: 'Bluray-1080p', size: '16.9 GB', score: 12100, languages: de, group: 'SAUERKRAUT' } },
      { slot: 'UHD', profileId: 'uhd', state: 'downloading', progress: 64, lastSearched: '2026-10-17', missingSince: '2026-10-17' },
    ],
    request: { by: 'Jonas', source: 'Silo', at: '2026-10-17 09:12', slots: ['UHD'] },
  },
  {
    id: 'insideout2', kind: 'movie', title: 'Inside Out 2', primaryTitle: 'Alles steht Kopf 2', year: 2024, tmdbId: 1022789, imdbId: 'tt22022452',
    overview: 'Teenager Riley’s mind headquarters is undergoing a sudden demolition to make room for something entirely unexpected: new Emotions.',
    runtime: '1h 37m', certification: 'FSK 0', originalLanguage: 'English', genres: ['Animation', 'Family'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2024-06-13', digital: '2024-08-20', physical: '2024-10-10' },
    folder: '/data/media/movies/Inside Out 2 (2024) {tmdb-1022789}', hue: 280,
    versions: [
      { slot: 'SD', profileId: 'sd', state: 'available', lastSearched: '2026-09-21', file: { path: 'Inside Out 2 (2024) {tmdb-1022789} - [SD][WEBDL-480p][German DL][AAC 2.0][x264]-iNKLUSiON.mkv', quality: 'WEBDL-480p', size: '1.1 GB', score: 10950, languages: de, group: 'iNKLUSiON' } },
      { slot: 'HD', profileId: 'kids', state: 'available', lastSearched: '2026-09-21', file: { path: 'Inside Out 2 (2024) {tmdb-1022789} - [HD][Bluray-1080p][German DL][DTS-HD MA 7.1][x264]-ZeroTwo.mkv', quality: 'Bluray-1080p', size: '9.8 GB', score: 12900, languages: de, group: 'ZeroTwo' } },
    ],
    request: { by: 'Anna', source: 'Silo', at: '2026-08-02 18:40', slots: ['HD'] },
  },
  {
    id: 'paddington', kind: 'movie', title: 'Paddington in Peru', year: 2024, tmdbId: 516729, imdbId: 'tt5822536',
    overview: 'Paddington travels to Peru to visit his beloved Aunt Lucy, who now resides at the Home for Retired Bears.',
    runtime: '1h 46m', certification: 'FSK 0', originalLanguage: 'English', genres: ['Family', 'Comedy'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2025-01-30', digital: '2025-04-04' },
    folder: '/data/media/movies/Paddington in Peru (2024) {tmdb-516729}', hue: 200,
    versions: [
      { slot: 'HD', profileId: 'kids', state: 'available', lastSearched: '2026-10-11', file: { path: 'Paddington in Peru (2024) {tmdb-516729} - [HD][WEBDL-1080p][German DL][EAC3 5.1][h264]-MGE.mkv', quality: 'WEBDL-1080p', size: '6.4 GB', score: 11800, languages: de, group: 'MGE' } },
    ],
    request: { by: 'Anna', source: 'Silo', at: '2025-03-28 07:55', slots: ['HD'] },
  },
  {
    id: 'brutalist', kind: 'movie', title: 'The Brutalist', primaryTitle: 'Der Brutalist', year: 2024, tmdbId: 549509, imdbId: 'tt8999762',
    overview: 'A visionary architect flees post-war Europe in 1947 to rebuild his life, his career, and his marriage in America.',
    runtime: '3h 35m', certification: 'FSK 16', originalLanguage: 'English', genres: ['Drama'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2025-01-30', digital: '2025-05-22' },
    folder: '/data/media/movies/The Brutalist (2024) {tmdb-549509}', hue: 45,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'missing', missingSince: '2025-05-22', lastSearched: '2026-10-09' },
    ],
  },
  {
    id: 'mickey17', kind: 'movie', title: 'Mickey 17', year: 2025, tmdbId: 696506, imdbId: 'tt12299608',
    overview: 'An expendable employee on a human expedition sent to colonize the ice world Niflheim keeps dying and being regenerated.',
    runtime: '2h 17m', certification: 'FSK 16', originalLanguage: 'English', genres: ['Science Fiction', 'Comedy'], status: 'Released', monitoring: 'All',
    releaseDates: { theatrical: '2025-03-06', digital: '2025-04-08', physical: '2025-05-27' },
    folder: '/data/media/movies/Mickey 17 (2025) {tmdb-696506}', hue: 170,
    versions: [
      { slot: 'HD', profileId: 'hd-orig', state: 'available', lastSearched: '2026-10-05', file: { path: 'Mickey 17 (2025) {tmdb-696506} - [HD][WEBDL-1080p][EAC3 Atmos 5.1][h264]-FLUX.mkv', quality: 'WEBDL-1080p', size: '7.2 GB', score: 2150, languages: ['English'], group: 'FLUX' } },
    ],
  },
  {
    id: 'dune3', kind: 'movie', title: 'Dune: Part Three', year: 2026, tmdbId: 1170608, imdbId: 'tt31378509',
    overview: 'The third installment of Denis Villeneuve’s adaptation, based on Frank Herbert’s Dune Messiah.',
    runtime: '—', certification: 'not rated yet', originalLanguage: 'English', genres: ['Science Fiction'], status: 'Announced', monitoring: 'All',
    releaseDates: { theatrical: '2026-12-17' },
    folder: '/data/media/movies/Dune Part Three (2026) {tmdb-1170608}', hue: 25,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'unreleased' },
      { slot: 'UHD', profileId: 'uhd', state: 'unreleased' },
    ],
    request: { by: 'Jonas', source: 'Silo', at: '2026-09-14 21:03', slots: ['HD', 'UHD'] },
  },
  {
    id: 'severance', kind: 'series', title: 'Severance', year: 2022, tmdbId: 95396, tvdbId: 371980, imdbId: 'tt11280740',
    overview: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
    runtime: '50m', certification: 'FSK 16', originalLanguage: 'English', genres: ['Drama', 'Mystery'], status: 'Continuing', monitoring: 'All',
    folder: '/data/media/tv/Severance (2022) {tvdb-371980}', hue: 210,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'available', episodesHave: 19, episodesWanted: 19, lastSearched: '2026-10-01' },
      { slot: 'UHD', profileId: 'uhd', state: 'missing', episodesHave: 9, episodesWanted: 19, missingSince: '2025-03-21', lastSearched: '2026-10-12' },
    ],
    seasons: [
      { number: 1, monitored: true, episodes: [
        ep(1, 'Good News About Hell', '2022-02-18', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(2, 'Half Loop', '2022-02-18', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(3, 'In Perpetuity', '2022-02-25', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(4, 'The You You Are', '2022-03-04', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(5, 'The Grim Barbarity of Optics and Design', '2022-03-11', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(6, 'Hide and Seek', '2022-03-18', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(7, 'Defiant Jazz', '2022-03-25', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(8, 'What’s for Dinner?', '2022-04-01', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
        ep(9, 'The We We Are', '2022-04-08', { HD: f('WEBDL-1080p', 11200), UHD: f('WEBDL-2160p', 12400) }),
      ] },
      { number: 2, monitored: true, episodes: [
        ep(1, 'Hello, Ms. Cobel', '2025-01-17', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(2, 'Goodbye, Mrs. Selvig', '2025-01-24', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(3, 'Who Is Alive?', '2025-01-31', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(4, 'Woe’s Hollow', '2025-02-07', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(5, 'Trojan’s Horse', '2025-02-14', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(6, 'Attila', '2025-02-21', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(7, 'Chikhai Bardo', '2025-02-28', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(8, 'Sweet Vitriol', '2025-03-07', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
        ep(9, 'The After Hours', '2025-03-14', { HD: f('WEBDL-1080p', 11200, ['German']), UHD: 'missing' }),
        ep(10, 'Cold Harbor', '2025-03-21', { HD: f('WEBDL-1080p', 11200), UHD: 'missing' }),
      ] },
    ],
  },
  {
    id: 'slowhorses', kind: 'series', title: 'Slow Horses', year: 2022, tmdbId: 95480, tvdbId: 386051, imdbId: 'tt5875444',
    overview: 'A dysfunctional team of MI5 agents, banished to Slough House for career-ending mistakes, keep getting pulled back into the game.',
    runtime: '45m', certification: 'FSK 16', originalLanguage: 'English', genres: ['Drama', 'Thriller'], status: 'Continuing', monitoring: 'Future only', nextAiring: '2026-10-21',
    folder: '/data/media/tv/Slow Horses (2022) {tvdb-386051}', hue: 140,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'downloading', progress: 22, episodesHave: 3, episodesWanted: 4, lastSearched: '2026-10-17' },
    ],
    seasons: [
      { number: 6, monitored: true, episodes: [
        ep(1, 'Rotten Apples', '2026-09-30', { HD: f('WEBDL-1080p', 10400, ['German']) }),
        ep(2, 'Dead Drop', '2026-09-30', { HD: f('WEBDL-1080p', 10400, ['German']) }),
        ep(3, 'Old Habits', '2026-10-07', { HD: f('WEBDL-1080p', 11200) }),
        ep(4, 'Cold Feet', '2026-10-14', { HD: 'downloading' }),
        ep(5, 'Episode 5', '2026-10-21', { HD: 'unreleased' }),
        ep(6, 'Episode 6', '2026-10-28', { HD: 'unreleased' }),
      ] },
    ],
  },
  {
    id: 'dark', kind: 'series', title: 'Dark', year: 2017, tmdbId: 70523, tvdbId: 334824, imdbId: 'tt5753856',
    overview: 'A missing child sets four families on a frantic hunt for answers as they unearth a mind-bending mystery that spans three generations.',
    runtime: '55m', certification: 'FSK 16', originalLanguage: 'German', genres: ['Drama', 'Mystery'], status: 'Ended', monitoring: 'All',
    folder: '/data/media/tv/Dark (2017) {tvdb-334824}', hue: 260,
    versions: [
      { slot: 'HD', profileId: 'hd', state: 'available', episodesHave: 26, episodesWanted: 26, lastSearched: '2026-09-18' },
    ],
    seasons: [1, 2, 3].map((n) => ({ number: n, monitored: true, episodes: Array.from({ length: n === 1 ? 10 : 8 }, (_, i) => ep(i + 1, `Episode ${i + 1}`, `${2016 + n}-12-01`, { HD: f('WEBDL-1080p', 10950, ['German']) })) })),
  },
  {
    id: 'bluey', kind: 'series', title: 'Bluey', year: 2018, tmdbId: 82728, tvdbId: 353546, imdbId: 'tt7678620',
    overview: 'Bluey is an inexhaustible six-year-old Blue Heeler dog who loves to play.',
    runtime: '7m', certification: 'FSK 0', originalLanguage: 'English', genres: ['Animation', 'Kids'], status: 'Continuing', monitoring: 'All',
    folder: '/data/media/tv/Bluey (2018) {tvdb-353546}', hue: 195,
    versions: [
      { slot: 'SD', profileId: 'sd', state: 'missing', episodesHave: 118, episodesWanted: 151, missingSince: '2025-11-02', lastSearched: '2026-10-16' },
      { slot: 'HD', profileId: 'kids', state: 'available', episodesHave: 151, episodesWanted: 151, lastSearched: '2026-10-03' },
    ],
    request: { by: 'Anna', source: 'Silo', at: '2025-11-02 16:20', slots: ['HD'] },
    seasons: [
      { number: 3, monitored: true, episodes: Array.from({ length: 6 }, (_, i) => ep(i + 1, ['Family Meeting', 'Pass the Parcel', 'Faceytalk', 'Housework', 'Dragon', 'Wild Girls'][i], '2022-06-1' + i, { SD: i < 3 ? f('WEBDL-480p', 9800) : 'missing', HD: f('WEBDL-1080p', 11800) })) },
    ],
  },
  {
    id: 'shogun', kind: 'series', title: 'Shōgun', year: 2024, tmdbId: 126308, tvdbId: 392573, imdbId: 'tt2788316',
    overview: 'In 1600 Japan, Lord Yoshii Toranaga fights for his life as his enemies on the Council of Regents unite against him.',
    runtime: '58m', certification: 'FSK 16', originalLanguage: 'English', genres: ['Drama', 'History'], status: 'Continuing', monitoring: 'Future only',
    folder: '/data/media/tv/Shogun (2024) {tvdb-392573}', hue: 0,
    versions: [
      { slot: 'HD', profileId: 'hd-orig', state: 'available', episodesHave: 10, episodesWanted: 10, lastSearched: '2026-09-25' },
      { slot: 'UHD', profileId: 'uhd-orig', state: 'available', episodesHave: 10, episodesWanted: 10, lastSearched: '2026-09-25' },
    ],
    seasons: [
      { number: 1, monitored: true, episodes: Array.from({ length: 10 }, (_, i) => ep(i + 1, ['Anjin', 'Servants of Two Masters', 'Tomorrow Is Tomorrow', 'The Eightfold Fence', 'Broken to the Fist', 'Ladies of the Willow World', 'A Stick of Time', 'The Abyss of Life', 'Crimson Sky', 'A Dream of a Dream'][i], '2024-03-' + String(i * 3 + 1).padStart(2, '0'), { HD: f('WEBDL-1080p', 2400, ['English', 'Japanese']), UHD: f('WEBDL-2160p', 3100, ['English', 'Japanese']) })) },
    ],
  },
]
export const titleById = (id: string) => titles.find((t) => t.id === id)!

export const isLongMissing = (v: Version) => v.state === 'missing' && !!v.missingSince && daysBetween(v.missingSince, TODAY) >= 90
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

// ── Activity ────────────────────────────────────────────────────────────────

export type QueueItem = {
  id: string; titleId: string; slot: Slot; label: string; release: string; indexer: string
  phase: 'queued' | 'downloading' | 'paused' | 'importing'; progress: number; size: string; left: string; eta: string; score: number; upgrade: boolean
}
export const queue: QueueItem[] = [
  { id: 'q1', titleId: 'oppenheimer', slot: 'UHD', label: 'Oppenheimer', release: 'Oppenheimer.2023.German.DL.2160p.UHD.BluRay.DV.HDR10.x265-W4K', indexer: 'NZBgeek', phase: 'downloading', progress: 64, size: '58.4 GB', left: '21.0 GB', eta: '14 min', score: 15200, upgrade: false },
  { id: 'q2', titleId: 'slowhorses', slot: 'HD', label: 'Slow Horses S06E04', release: 'Slow.Horses.S06E04.German.DL.1080p.WEB.h264-WvF', indexer: 'DrunkenSlug', phase: 'downloading', progress: 22, size: '2.9 GB', left: '2.3 GB', eta: '2 min', score: 11200, upgrade: false },
  { id: 'q3', titleId: 'slowhorses', slot: 'HD', label: 'Slow Horses S06E01–E02', release: 'Slow.Horses.S06E01.German.DL.1080p.WEB.h264-WvF', indexer: 'DrunkenSlug', phase: 'queued', progress: 0, size: '5.6 GB', left: '5.6 GB', eta: '—', score: 11200, upgrade: true },
  { id: 'q4', titleId: 'bluey', slot: 'SD', label: 'Bluey S03E04', release: 'Bluey.S03E04.German.DL.480p.WEB.x264-iNKLUSiON', indexer: 'NZBgeek', phase: 'importing', progress: 100, size: '140 MB', left: '0 B', eta: '—', score: 9800, upgrade: false },
]

export type HistoryEvent = {
  id: string; at: string; type: 'Grabbed' | 'Imported' | 'Upgraded' | 'Failed' | 'Blocklisted' | 'Renamed' | 'Requested' | 'Version added' | 'Adopted'
  titleId: string; slot?: Slot; label: string; release?: string; score?: number; detail: string; indexer?: string
}
export const history: HistoryEvent[] = [
  { id: 'h1', at: '2026-10-17 09:13', type: 'Grabbed', titleId: 'oppenheimer', slot: 'UHD', label: 'Oppenheimer', release: 'Oppenheimer.2023.German.DL.2160p.UHD.BluRay.DV.HDR10.x265-W4K', score: 15200, indexer: 'NZBgeek', detail: 'Search on add · best of 37 Releases' },
  { id: 'h2', at: '2026-10-17 09:12', type: 'Requested', titleId: 'oppenheimer', slot: 'UHD', label: 'Oppenheimer', detail: 'Jonas via Silo asked for UHD · Version added with UHD' },
  { id: 'h3', at: '2026-10-17 08:41', type: 'Blocklisted', titleId: 'slowhorses', slot: 'HD', label: 'Slow Horses S06E04', release: 'Slow.Horses.S06E04.German.DL.1080p.WEB.h264-ZZGtv', score: 11200, indexer: 'NZBgeek', detail: 'SABnzbd: Failed (missing articles) · retried next-best from cache' },
  { id: 'h4', at: '2026-10-17 08:41', type: 'Grabbed', titleId: 'slowhorses', slot: 'HD', label: 'Slow Horses S06E04', release: 'Slow.Horses.S06E04.German.DL.1080p.WEB.h264-WvF', score: 11200, indexer: 'DrunkenSlug', detail: 'Retry after failure · cached candidates (2 h old)' },
  { id: 'h5', at: '2026-10-16 22:05', type: 'Upgraded', titleId: 'dune2', slot: 'UHD', label: 'Dune: Part Two', release: 'Dune.Part.Two.2024.German.DL.2160p.UHD.BluRay.DV.HDR10.TrueHD.x265-W4K', score: 15200, indexer: 'NZBgeek', detail: 'Score 11 900 → 15 200 · German → German DL' },
  { id: 'h6', at: '2026-10-16 03:30', type: 'Failed', titleId: 'brutalist', slot: 'HD', label: 'The Brutalist', release: 'The.Brutalist.2024.1080p.BluRay.x264-GERMANDUB', score: 10000, indexer: 'altHUB', detail: 'Import rejected: ffprobe found English audio only, Profile HD requires German · blocklisted' },
  { id: 'h7', at: '2026-10-15 19:44', type: 'Imported', titleId: 'slowhorses', slot: 'HD', label: 'Slow Horses S06E03', release: 'Slow.Horses.S06E03.German.DL.1080p.WEB.h264-WvF', score: 11200, detail: 'RSS · probed German, English' },
  { id: 'h8', at: '2026-10-14 12:00', type: 'Renamed', titleId: 'mickey17', label: 'Mickey 17', detail: 'Metadata changed: year corrected · 1 Version renamed' },
  { id: 'h9', at: '2026-10-12 10:17', type: 'Version added', titleId: 'severance', slot: 'UHD', label: 'Severance', detail: 'UHD Version added in Kestrel · Profile UHD' },
  { id: 'h10', at: '2026-10-01 20:30', type: 'Adopted', titleId: 'dark', slot: 'HD', label: 'Dark', detail: '26 files matched by name and ID tag' },
]

export type BlocklistEntry = { id: string; at: string; titleId: string; slot: Slot; release: string; indexer: string; reason: string }
export const blocklist: BlocklistEntry[] = [
  { id: 'b1', at: '2026-10-17 08:41', titleId: 'slowhorses', slot: 'HD', release: 'Slow.Horses.S06E04.German.DL.1080p.WEB.h264-ZZGtv', indexer: 'NZBgeek', reason: 'SABnzbd Failed: missing articles' },
  { id: 'b2', at: '2026-10-16 03:30', titleId: 'brutalist', slot: 'HD', release: 'The.Brutalist.2024.1080p.BluRay.x264-GERMANDUB', indexer: 'altHUB', reason: 'Probed audio lacks German' },
  { id: 'b3', at: '2026-09-02 14:12', titleId: 'severance', slot: 'UHD', release: 'Severance.S02.German.DL.2160p.WEB.H265-RAR', indexer: 'DrunkenSlug', reason: 'SABnzbd ENCRYPTED' },
]

// ── Upcoming ────────────────────────────────────────────────────────────────

export type UpcomingItem = { date: string; titleId: string; label: string; what: string; slots: Slot[]; searchable: boolean }
export const upcoming: UpcomingItem[] = [
  { date: '2026-10-21', titleId: 'slowhorses', label: 'Slow Horses', what: 'S06E05 · Episode 5', slots: ['HD'], searchable: true },
  { date: '2026-10-24', titleId: 'bluey', label: 'Bluey', what: 'S04E01 · Episode 1', slots: ['SD', 'HD'], searchable: true },
  { date: '2026-10-28', titleId: 'slowhorses', label: 'Slow Horses', what: 'S06E06 · Episode 6', slots: ['HD'], searchable: true },
  { date: '2026-11-04', titleId: 'severance', label: 'Severance', what: 'S03E01 · Episode 1', slots: ['HD', 'UHD'], searchable: true },
  { date: '2026-12-17', titleId: 'dune3', label: 'Dune: Part Three', what: 'Theatrical (DE) · not searchable until digital', slots: ['HD', 'UHD'], searchable: false },
  { date: '2027-03-16', titleId: 'dune3', label: 'Dune: Part Three', what: 'Released (est. theatrical + 90 days)', slots: ['HD', 'UHD'], searchable: true },
]

// ── Manual search ───────────────────────────────────────────────────────────

export type SearchResult = {
  release: string; indexer: string; size: string; age: string; quality: string; languages: string[]; score: number
  formats: string[]; rejections: string[]; otherSlot?: Slot; blocklisted?: boolean; current?: boolean
}
// Manual search for Oppenheimer · HD Version (Profile HD) — sorted by score
export const manualSearch: SearchResult[] = [
  { release: 'Oppenheimer.2023.German.DL.1080p.BluRay.x264-SAUERKRAUT', indexer: 'NZBgeek', size: '16.9 GB', age: '331 d', quality: 'Bluray-1080p', languages: ['German', 'English'], score: 12100, formats: ['German DL', 'German Bluray Tier 01', 'DTS', 'Repack'], rejections: [], current: true },
  { release: 'Oppenheimer.2023.German.DL.1080p.BluRay.AVC.REMUX-pmHD', indexer: 'DrunkenSlug', size: '38.1 GB', age: '402 d', quality: 'Remux-1080p', languages: ['German', 'English'], score: 0, formats: ['German DL'], rejections: ['Quality Remux-1080p not allowed in Profile HD'] },
  { release: 'Oppenheimer.2023.German.DL.1080p.WEB.H264-ZeroTwo', indexer: 'DrunkenSlug', size: '9.4 GB', age: '690 d', quality: 'WEBDL-1080p', languages: ['German', 'English'], score: 11400, formats: ['German DL', 'German Web Tier 02'], rejections: ['Not an Upgrade: 11 400 ≤ current 12 100'] },
  { release: 'Oppenheimer.2023.German.AC3.1080p.BluRay.x264-HDSource', indexer: 'altHUB', size: '12.0 GB', age: '320 d', quality: 'Bluray-1080p', languages: ['German'], score: 10600, formats: ['German', 'German Bluray Tier 02'], rejections: ['Not an Upgrade: 10 600 ≤ current 12 100'] },
  { release: 'Oppenheimer.2023.1080p.BluRay.DDP5.1.x264-ZoroSenpai', indexer: 'NZBgeek', size: '14.8 GB', age: '380 d', quality: 'Bluray-1080p', languages: ['English'], score: 1950, formats: ['Bluray Tier 01', 'DD+'], rejections: ['Profile HD requires German audio'] },
  { release: 'Oppenheimer.2023.German.DL.2160p.UHD.BluRay.x265-W4K', indexer: 'NZBgeek', size: '58.4 GB', age: '333 d', quality: 'Bluray-2160p', languages: ['German', 'English'], score: 15200, formats: ['German DL', 'DV HDR10', 'TrueHD Atmos'], rejections: ['Fits the UHD Slot, not this Version'], otherSlot: 'UHD' },
  { release: 'Oppenheimer.2023.German.DL.1080p.BluRay.x264-GERMANDUB', indexer: 'altHUB', size: '11.2 GB', age: '12 d', quality: 'Bluray-1080p', languages: ['German', 'English'], score: 12300, formats: ['German DL'], rejections: ['Blocklisted 2026-10-02: probed audio lacks German'], blocklisted: true },
]

// ── Add-search (TMDB-backed, Movies and Series together) ────────────────────

export type AddResult = { tmdbId: number; kind: Kind; title: string; primaryTitle?: string; year: number; certification: string; inLibrary?: boolean; notOnTvdb?: boolean; hue: number; overview: string }
export const addResults: AddResult[] = [
  { tmdbId: 1061474, kind: 'movie', title: 'Superman', year: 2025, certification: 'FSK 12', hue: 220, overview: 'Superman must reconcile his alien Kryptonian heritage with his human upbringing as reporter Clark Kent.' },
  { tmdbId: 1100988, kind: 'movie', title: 'The Wild Robot', primaryTitle: 'Der wilde Roboter', year: 2024, certification: 'FSK 6', hue: 90, overview: 'After a shipwreck, an intelligent robot called Roz is stranded on an uninhabited island.' },
  { tmdbId: 1399, kind: 'series', title: 'Game of Thrones', year: 2011, certification: 'FSK 16', hue: 10, overview: 'Seven noble families fight for control of the mythical land of Westeros.' },
  { tmdbId: 693134, kind: 'movie', title: 'Dune: Part Two', year: 2024, certification: 'FSK 12', inLibrary: true, hue: 32, overview: 'Paul Atreides unites with Chani and the Fremen.' },
  { tmdbId: 247174, kind: 'series', title: 'Mahabharat (web shorts)', year: 2023, certification: '—', notOnTvdb: true, hue: 300, overview: 'A web series only listed on TMDB.' },
]

// ── Settings ────────────────────────────────────────────────────────────────

export const settings = {
  primaryLanguage: 'German',
  releaseCountry: 'DE',
  displayLanguage: 'English',
  kidsRule: { on: true, threshold: 6 as 0 | 6 | 12 },
  sabnzbd: { url: 'http://sabnzbd:8080', category: 'kestrel', status: 'Connected · v4.5.3', free: '1.8 TB free on /data' },
  indexers: [
    { name: 'NZBgeek', url: 'https://api.nzbgeek.info', limit: '2 500 / day', used: '1 210 today', status: 'ok' as const, idSearch: true },
    { name: 'DrunkenSlug', url: 'https://api.drunkenslug.com', limit: '1 000 / day', used: '812 today', status: 'ok' as const, idSearch: true },
    { name: 'altHUB', url: 'https://api.althub.co.za', limit: 'not reported · 1 req / 10 s', used: '140 today', status: 'paused' as const, idSearch: false, pausedUntil: 'HTTP 429 · paused until 10:41' },
  ],
  rootFolders: [{ kind: 'movie' as Kind, path: '/data/media/movies', free: '1.8 TB' }, { kind: 'series' as Kind, path: '/data/media/tv', free: '1.8 TB' }],
  downloadFolders: { movie: '/data/usenet/movies', series: '/data/usenet/tv' },
  apiKey: 'kst_4f1e9c2a••••••••••••b7d0',
  trash: { snapshot: '2026-09-28', latest: '2026-10-11' },
  metadata: { tmdbKey: 'embedded', tvdbKey: 'embedded', lastRefresh: '2026-10-17 04:00' },
}
