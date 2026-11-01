// The Episode and Season result rows of the Library list (see useEpisodeResults.ts), above the Titles: the poster, which
// Series and episode or season, its state, and Search and Manual… on the row. They are options of the list's cursor
// listbox, so j/k reach them, `s` and `m` act on the one under the cursor and Enter opens the Title on that season.
import { Button, Entity } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { Episode } from '../api/queries'
import { TitlePoster } from '../poster'
import { ManualButton, RowButtons, wantedIn, type EpisodeActions } from './EpisodeActions'
import type { EpisodeHit } from './useEpisodeResults'
import { episodeCode, seasonName, seasonStanding } from './episodes'
import { toneText, type Tone } from './rowState'
import { slotKeys, slotLabel } from './bits'

type State = 'wanted' | 'downloading' | 'unreleased' | 'unmonitored' | 'filled'

export const hitDomId = (h: EpisodeHit) => `hit-${h.key}`

/** What the episode's state says, toned: Wanted (in which Slot, when only one is), downloading, or what it holds. */
function episodeState(e: Episode, slots: readonly string[]): { text: string; tone: Tone; state: State } {
  const states = slotKeys.filter((k) => slots.includes(k)).map((k) => ({ k, s: e.cells[k]?.state }))
  const some = (state: string) => states.filter((x) => x.s === state)
  const which = (xs: typeof states) => (slots.length > 1 && xs.length < states.length ? ` in ${slotLabel[xs[0].k]}` : '')
  if (some('wanted').length > 0) return { text: `Wanted${which(some('wanted'))}`, tone: 'warning', state: 'wanted' }
  if (some('downloading').length > 0) return { text: `Downloading${which(some('downloading'))}`, tone: 'info', state: 'downloading' }
  if (some('unreleased').length > 0) return { text: 'Not out yet', tone: 'quiet', state: 'unreleased' }
  if (states.length > 0 && states.every((x) => x.s === 'unmonitored')) return { text: 'Unmonitored', tone: 'quiet', state: 'unmonitored' }
  return { text: 'Filled', tone: 'quiet', state: 'filled' }
}

type Props = {
  hits: EpisodeHit[]
  /** The cursor's result, or null while it is on a Title. */
  current: EpisodeHit | null
  actionsOf: (hit: EpisodeHit) => Pick<EpisodeActions, 'versions' | 'search' | 'manual'>
  /** A click on a row (not on its buttons). */
  onPick: (hit: EpisodeHit) => void
  phone: boolean
}

const heading = (text: string): ReactNode => (
  <li role="presentation" className="label-12 px-2.5 pt-2.5 pb-1 text-gray-900">
    {text}
  </li>
)

/** The result rows, under a heading each for Episode and Season; the Titles' own heading follows them. */
export function EpisodeHitRows({ hits, current, actionsOf, onPick, phone }: Props) {
  if (hits.length === 0) return null
  const episodes = hits.filter((h) => h.kind === 'episode')
  const seasons = hits.filter((h) => h.kind === 'season')
  const row = (h: EpisodeHit) => {
    const actions = actionsOf(h)
    const slots = h.versions.map((v) => v.slot)
    const code = h.episode ? episodeCode(h.episode) : null
    let line: { text: string; tone: Tone }
    if (h.episode) {
      const state = episodeState(h.episode, slots)
      line = { text: [h.episode.primary_name || h.episode.name || 'TBA', state.text].join(' · '), tone: state.tone }
    } else {
      const st = seasonStanding(h.episodes, slots)
      line = {
        text: [`${st.filled} of ${st.total}`, st.downloading > 0 ? `${st.downloading} downloading` : null, st.wanted > 0 ? `${st.wanted} Wanted` : null].filter(Boolean).join(' · '),
        tone: st.wanted > 0 ? 'warning' : 'quiet',
      }
    }
    const on = current?.key === h.key
    return (
      <Entity
        key={h.key}
        as="li"
        id={hitDomId(h)}
        // chrome-ok: a row of the cursor listbox; Select and Combobox are pickers
        role="option"
        aria-selected={on}
        current={on && !phone}
        data-nav={`lib-${hits.indexOf(h)}`}
        onClick={() => onPick(h)}
        left={<TitlePoster id={h.title.id} hasPoster={h.title.has_poster} size={phone ? 'md' : 'sm'} />}
        right={
          // The buttons are the row's own: a click on them does not also pick the row.
          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {h.episode ? <RowButtons actions={actions} episode={h.episode} /> : <SeasonButtons actions={actions} season={h.season} episodes={h.episodes} />}
          </span>
        }
      >
        <Entity.Content
          fill
          title={
            <span className="block truncate">
              {h.title.title} <span className="label-13 font-normal text-gray-900">{code ?? seasonName(h.season)}</span>
            </span>
          }
          description={<span className={`block truncate ${toneText[line.tone]}`}>{line.text}</span>}
        />
      </Entity>
    )
  }
  return (
    <>
      {episodes.length > 0 && heading('Episode')}
      {episodes.map(row)}
      {seasons.length > 0 && heading('Season')}
      {seasons.map(row)}
      {heading('Title')}
    </>
  )
}

/** A season result's buttons: Search N (its Wanted episodes) and Manual…. */
function SeasonButtons({ actions, season, episodes }: { actions: Pick<EpisodeActions, 'versions' | 'search' | 'manual'>; season: number; episodes: Episode[] }) {
  const name = seasonName(season)
  const wanted = episodes.filter((e) => actions.versions.some((v) => e.cells[v.slot]?.state === 'wanted')).length
  return (
    <>
      <Button
        variant="secondary"
        size="tiny"
        aria-label={`Search ${name}`}
        tabIndex={-1}
        disabled={!wantedIn(episodes, actions.versions)}
        onClick={() => actions.search(episodes, name, () => ({ season }))}
      >
        {wanted > 0 ? `Search ${wanted}` : 'Search'}
      </Button>
      <ManualButton versions={actions.versions} text="Manual…" name={`Manual search ${name}`} keyboard={false} size="tiny" onPick={(v) => actions.manual(v, { season }, name)} />
    </>
  )
}
