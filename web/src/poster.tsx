// chrome: pending
// The one poster frame the SPA draws: a lazy image, or the same-size placeholder when there is none.
import { apiBaseUrl } from './api/client'
import { cx } from './ui'

/**
 * A poster, or an empty placeholder of the same size when `src` is null. With
 * no `alt` it is decorative (a thumbnail beside the Title's name). The caller's
 * `className` sizes and rounds it.
 */
export function Poster({ src, alt = '', className }: { src: string | null; alt?: string; className: string }) {
  return (
    <span data-poster aria-hidden={alt ? undefined : true} className={cx('block shrink-0 overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300', className)}>
      {src && <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />}
    </span>
  )
}

/** A Library Title's poster, served by `GET /titles/{id}/poster` when the Title has one (`has_poster`). */
export function TitlePoster({ id, hasPoster, alt, className }: { id: number; hasPoster: boolean; alt?: string; className: string }) {
  return <Poster src={hasPoster ? `${apiBaseUrl}/titles/${id}/poster` : null} alt={alt} className={className} />
}
