import type { LookupDetail } from '../api/queries'
import { cx } from '../ui'
import { SeriesFacts } from './SeriesOverview'

/**
 * A TMDB poster, or an empty frame of the same size when there is none. With
 * no `alt` it is decorative (a search result's thumbnail beside its title).
 */
export function Poster({ src, alt = '', className }: { src: string | null; alt?: string; className: string }) {
  return (
    <span className={cx('block shrink-0 overflow-hidden rounded-sm bg-gray-alpha-200', className)}>
      {src && <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />}
    </span>
  )
}

/** The add panel's description of a Title: poster, year, age rating, runtime, genres and overview, and a Series' status line. */
export function LookupSummary({ detail }: { detail: LookupDetail }) {
  const facts = [
    detail.year ? String(detail.year) : null,
    detail.certification,
    detail.runtime ? `${detail.runtime} min` : null,
    detail.genres.length > 0 ? detail.genres.join(', ') : null,
  ].filter(Boolean)
  return (
    <div className="mb-3 flex gap-3">
      <Poster src={detail.poster} alt={`${detail.title} poster`} className="h-[120px] w-20" />
      <div className="min-w-0 flex-1 text-[12px]">
        {facts.length > 0 && <p className="text-gray-900">{facts.join(' · ')}</p>}
        {detail.series && <SeriesFacts series={detail.series} />}
        {detail.overview && <p className="mt-1.5 line-clamp-5 text-[13px] leading-snug">{detail.overview}</p>}
      </div>
    </div>
  )
}
