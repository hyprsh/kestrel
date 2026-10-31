// "Find an episode": the field and what it does with its text, shared by the Title page (which goes to the found episode's
// season tab and highlights its row) and the grid's summary (which opens the season row and highlights the episode).
import { SearchInput } from '@hyprsh/design'
import { useMemo, useState } from 'react'
import type { Episode } from '../api/queries'
import { findEpisodes } from './episodeCode'

/** The text of a Find field, the episodes it matches in `episodes`, and `onFound` for the one it goes to (null: none). */
export function useEpisodeFind(episodes: Episode[], onFound: (episode: Episode | null) => void, initial = '') {
  const [text, setText] = useState(initial)
  const [at, setAt] = useState(0)
  const matches = useMemo(() => findEpisodes(episodes, text), [episodes, text])
  const find = (next: string, to = 0) => {
    setText(next)
    setAt(to)
    onFound(findEpisodes(episodes, next)[to] ?? null)
  }
  /** Goes on to the next match of a name that fits several episodes. */
  const step = () => find(text, (at + 1) % matches.length)
  return { text, setText, setAt, matches, find, step }
}

export type EpisodeFind = ReturnType<typeof useEpisodeFind>

/** The field. Enter steps through several matches; below it, a line says when nothing matches. */
export function FindEpisodeField({ find, placeholder = 'Find an episode' }: { find: EpisodeFind; placeholder?: string }) {
  return (
    <>
      <SearchInput
        aria-label="Find an episode"
        placeholder={placeholder}
        value={find.text}
        onChange={(e) => find.find(e.target.value)}
        onClear={() => find.find('')}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || find.matches.length < 2) return
          e.preventDefault()
          find.step()
        }}
      />
      {find.text.trim() !== '' && find.matches.length === 0 && (
        <p role="status" className="copy-13 mt-1 text-gray-900">
          No episode matches "{find.text.trim()}".
        </p>
      )}
    </>
  )
}
