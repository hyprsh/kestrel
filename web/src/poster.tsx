// chrome: domain-visual
// The one poster frame the SPA draws: a lazy image, or the same-size placeholder when there is none.
import { apiBaseUrl } from './api/client'
import { cx } from './ui'

/** The poster sizes, smallest first: a command menu thumbnail, a list row, a Grab row, the add panel, a Title page. */
const sizes = {
  xs: 'h-10 w-7 rounded-sm',
  sm: 'h-12 w-8 rounded-sm',
  md: 'h-15 w-10 rounded-sm',
  lg: 'h-[120px] w-20 rounded-sm',
  xl: 'h-36 w-24 rounded-md',
}

export type PosterSize = keyof typeof sizes

/**
 * A poster, or an empty placeholder of the same size when `src` is null. With
 * no `alt` it is decorative (a thumbnail beside the Title's name).
 */
export function Poster({ src, alt = '', size }: { src: string | null; alt?: string; size: PosterSize }) {
  return (
    <span data-poster aria-hidden={alt ? undefined : true} className={cx('block shrink-0 overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300', sizes[size])}>
      {src && <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />}
    </span>
  )
}

/** A Library Title's poster, served by `GET /titles/{id}/poster` when the Title has one (`has_poster`). */
export function TitlePoster({ id, hasPoster, alt, size }: { id: number; hasPoster: boolean; alt?: string; size: PosterSize }) {
  return <Poster src={hasPoster ? `${apiBaseUrl}/titles/${id}/poster` : null} alt={alt} size={size} />
}
