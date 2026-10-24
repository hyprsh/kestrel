// chrome: domain-visual
// A Grab row's poster: the Title's poster frame at the row's size, with the small rounding the row uses.
import { TitlePoster } from '../poster'

export function GrabPoster({ id, hasPoster }: { id: number; hasPoster: boolean }) {
  return <TitlePoster id={id} hasPoster={hasPoster} className="h-15 w-10 rounded-sm" />
}
