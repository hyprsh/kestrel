// chrome: domain-visual
// The one poster frame the SPA draws: a lazy image, or the same-size placeholder when there is none.
import { Skeleton } from '@hyprsh/design'
import { useState } from 'react'
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

/** The same sizes in pixels, for a Skeleton that stands where a poster will be. */
const pixels: Record<PosterSize, [number, number]> = { xs: [28, 40], sm: [32, 48], md: [40, 60], lg: [80, 120], xl: [96, 144] }

/** A Skeleton in a poster's box, for a row whose data is still loading. */
export function PosterSkeleton({ size }: { size: PosterSize }) {
  const [width, height] = pixels[size]
  return <Skeleton width={width} height={height} squared className="shrink-0" />
}

/**
 * A poster, or an empty placeholder of the same size when `src` is null. With
 * no `alt` it is decorative (a thumbnail beside the Title's name).
 */
export function Poster({ src, alt = '', size }: { src: string | null; alt?: string; size: PosterSize }) {
  // A Skeleton fills the frame until the image has loaded (or failed), then the image fades in; reduced motion skips the fade.
  const [loaded, setLoaded] = useState(false)
  return (
    <span
      data-poster
      data-loading={(src && !loaded) || undefined}
      aria-hidden={alt ? undefined : true}
      className={cx('relative block shrink-0 overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300', sizes[size])}
    >
      {src && !loaded && (
        <span className="absolute inset-0">
          <Skeleton width="100%" height="100%" squared />
        </span>
      )}
      {src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={cx('size-full object-cover motion-safe:transition-opacity motion-safe:duration-200', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  )
}

/** A Library Title's poster, served by `GET /titles/{id}/poster` when the Title has one (`has_poster`). */
export function TitlePoster({ id, hasPoster, alt, size }: { id: number; hasPoster: boolean; alt?: string; size: PosterSize }) {
  return <Poster src={hasPoster ? `${apiBaseUrl}/titles/${id}/poster` : null} alt={alt} size={size} />
}
