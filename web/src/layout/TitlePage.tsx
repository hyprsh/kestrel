// chrome: layout
import { TitlePoster } from '../poster'

/** The large poster at the head of a Title page, in its rounded frame. */
export function TitlePagePoster({ id, hasPoster, title }: { id: number; hasPoster: boolean; title: string }) {
  return <TitlePoster id={id} hasPoster={hasPoster} alt={`${title} poster`} className="h-36 w-24 rounded-md" />
}
