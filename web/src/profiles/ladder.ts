// What the Profile pages say about a Profile's qualities, sizes and cutoff, worked out from the API's data. No React in here.
import type { components } from '../api/schema.gen'

export type ProfileQuality = components['schemas']['ProfileQuality']
export type ProfileOverlay = components['schemas']['ProfileOverlay']
export type ProfileSize = components['schemas']['ProfileSize']
export type Kind = 'series' | 'movies'

/** "WEB-DL 2160p", "BluRay 1080p", "Remux 1080p": a quality as the Profile pages name it. */
export function qualityLabel(name: string): string {
  const remux = /^(?:Bluray-(\d{3,4}p) Remux|Remux-(\d{3,4}p))$/.exec(name)
  if (remux) return `Remux ${remux[1] ?? remux[2]}`
  const m = /^([A-Za-z]+)-?(\d{3,4}p)?$/.exec(name)
  if (!m) return name
  const source = ({ WEBDL: 'WEB-DL', WEBRip: 'WEBRip', Bluray: 'BluRay', HDTV: 'HDTV' } as Record<string, string>)[m[1]] ?? m[1]
  return m[2] ? `${source} ${m[2]}` : source
}

const GB = 1024 ** 3

/** Bytes as GB for the field: "2", "0.5", "" for no bound. */
export const toGb = (bytes: number | null | undefined): string => (bytes ? String(Math.round((bytes / GB) * 100) / 100) : '')

/** The bytes of a GB field; null for an empty or unreadable one. */
export function fromGb(text: string): number | null {
  const n = Number(text.replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * GB) : null
}

/** "1 – 10 GB", "up to 3 GB", "from 1 GB"; null for no bound. */
export function sizeRange(size: ProfileSize | { min?: number | null; max?: number | null } | undefined): string | null {
  const min = size?.min ?? null
  const max = size?.max ?? null
  if (min && max) return `${toGb(min)} – ${toGb(max)} GB`
  if (max) return `up to ${toGb(max)} GB`
  if (min) return `from ${toGb(min)} GB`
  return null
}

/** "1 – 10 GB per episode", "up to 40 GB per Movie"; null when the Profile limits neither. */
export function sizeFacts(overlay: ProfileOverlay | undefined): string[] {
  const episode = sizeRange(overlay?.episode_size)
  const movie = sizeRange(overlay?.movie_size)
  return [episode && `${episode} per episode`, movie && `${movie} per Movie`].filter((s): s is string => !!s)
}

/** "Upgrade until Score 2,000", "No Upgrades past the cutoff", "Upgrades never stop". */
export function upgradeFact(overlay: ProfileOverlay | undefined, cutoff: string | null | undefined): string {
  if (overlay?.upgrade_until != null) return `Upgrade until Score ${overlay.upgrade_until.toLocaleString('en-US')}`
  return cutoff ? 'No Upgrades past the cutoff' : 'Upgrades never stop'
}

/** The ladder with `from` moved to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Whether two ladders are the same list in the same order with the same ticks. */
export const sameLadder = (a: ProfileQuality[], b: ProfileQuality[]) => a.length === b.length && a.every((q, i) => q.name === b[i].name && q.accepted === b[i].accepted)

/** The qualities a card shows: the accepted ones, and those TRaSH accepts that the household turned off (struck through). */
export function cardLadder(ladder: ProfileQuality[], trash: ProfileQuality[]): ProfileQuality[] {
  const trashAccepts = new Set(trash.filter((q) => q.accepted).map((q) => q.name))
  return ladder.filter((q) => q.accepted || trashAccepts.has(q.name))
}
