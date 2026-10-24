// chrome: domain-visual
import { Poster, TitlePoster } from '../poster'

/** A Request's poster frame: the Title's poster, or the empty frame when the Request names no Title. */
export function RequestPoster({ titleId, hasPoster }: { titleId: number | null; hasPoster: boolean }) {
  return titleId != null ? <TitlePoster id={titleId} hasPoster={hasPoster} className="h-12 w-8 rounded-sm" /> : <Poster src={null} className="h-12 w-8 rounded-sm" />
}
