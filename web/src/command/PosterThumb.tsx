// chrome: domain-visual
import { Poster, TitlePoster } from '../poster'

/** The size of a row's poster thumbnail. */
const thumbSize = 'h-10 w-7 rounded-sm'

/** A result's poster thumbnail in a command menu row. */
export function PosterThumb({ src }: { src: string | null }) {
  return <Poster src={src} className={thumbSize} />
}

/** A Library Title's poster thumbnail in a command menu row. */
export function TitlePosterThumb({ id, hasPoster }: { id: number; hasPoster: boolean }) {
  return <TitlePoster id={id} hasPoster={hasPoster} className={thumbSize} />
}

/** The larger poster beside the add panel description. */
export function SummaryPoster({ src, alt }: { src: string | null; alt: string }) {
  return <Poster src={src} alt={alt} className="h-[120px] w-20 rounded-sm" />
}
