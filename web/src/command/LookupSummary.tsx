import type { ReactNode } from 'react'
import type { LookupDetail } from '../api/queries'
import { SummaryPoster } from './PosterThumb'

/** The add panel's description of a Title: poster, year, age rating, runtime, genres and overview, and a Series' status line (`series`). */
export function LookupSummary({ detail, series }: { detail: LookupDetail; series?: ReactNode }) {
  const facts = [
    detail.year ? String(detail.year) : null,
    detail.certification,
    detail.runtime ? `${detail.runtime} min` : null,
    detail.genres.length > 0 ? detail.genres.join(', ') : null,
  ].filter(Boolean)
  return (
    <div className="mb-3 flex gap-3">
      <SummaryPoster src={detail.poster} alt={`${detail.title} poster`} />
      <div className="label-13 min-w-0 flex-1">
        {facts.length > 0 && <p className="text-gray-900">{facts.join(' · ')}</p>}
        {series}
        {detail.overview && <p className="copy-13 mt-1.5 line-clamp-5">{detail.overview}</p>}
      </div>
    </div>
  )
}
