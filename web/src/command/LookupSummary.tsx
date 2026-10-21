import type { ReactNode } from 'react'
import type { LookupDetail } from '../api/queries'
import { Poster } from '../poster'

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
      <Poster src={detail.poster} alt={`${detail.title} poster`} className="h-[120px] w-20 rounded-sm" />
      <div className="min-w-0 flex-1 text-[12px]">
        {facts.length > 0 && <p className="text-gray-900">{facts.join(' · ')}</p>}
        {series}
        {detail.overview && <p className="mt-1.5 line-clamp-5 text-[13px] leading-snug">{detail.overview}</p>}
      </div>
    </div>
  )
}
