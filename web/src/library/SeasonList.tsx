// A Series' seasons in the grid's summary panel: a Search N Wanted button for the whole Series, the Find an episode
// field and a row per season with a square per episode, how many are there, Search N and Manual…. A season row opens to
// its episodes, which have Search and Manual… when they are Wanted. It uses the Title page's pieces: the finder, the
// search actions and the row buttons.
import { Button, Entity, Skeleton, StatusDot } from '@hyprsh/design'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useEpisodes, useProfiles, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { dotOf, slotKeys } from './bits'
import { episodeState } from './EpisodeHitRows'
import { ManualButton, RowButtons, useEpisodeSearch, versionsOf, wantedIn, type EpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeName } from './EpisodeName'
import { bySeason, episodeCode, orderEpisodes, orderSeasons, seasonName, seasonStanding } from './episodes'
import { toneText } from './rowState'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

export function SeasonList({ title, onManualSearch }: { title: TitleDetail; onManualSearch: (target: ManualSearchTarget) => void }) {
  const query = useEpisodes(title.id)
  const { display } = useDisplay()
  const profiles = useProfiles().data
  const searchEpisodes = useEpisodeSearch()
  const slots = slotKeys.filter((k) => title.versions.some((v) => v.slot === k))
  const versions = useMemo(() => versionsOf(title, slots, profiles), [title, slots, profiles])
  const episodes = useMemo(() => (query.data ? orderEpisodes(query.data, display.season_order) : noEpisodes), [query.data, display.season_order])
  const grouped = useMemo(() => bySeason(episodes), [episodes])
  const seasons = useMemo(() => orderSeasons([...grouped.keys()], display.season_order), [grouped, display.season_order])
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [found, setFound] = useState<number | null>(null)
  const find = useEpisodeFind(episodes, (hit) => {
    setFound(hit?.id ?? null)
    if (hit) setOpen((o) => new Set(o).add(hit.season))
  })
  useEffect(() => {
    if (found !== null) document.querySelector(`[data-episode="${found}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [found])

  const manual: EpisodeActions['manual'] = (v, body, label) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label } })

  if (query.isPending) return <Skeleton height={120} />
  if (episodes.length === 0) return null
  const wanted = seasonStanding(episodes, slots).wanted
  const toggle = (season: number) =>
    setOpen((o) => {
      const next = new Set(o)
      if (!next.delete(season)) next.add(season)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="small" disabled={wanted === 0} onClick={() => searchEpisodes(versions, episodes, title.title, (ids) => ({ episode_ids: ids }))}>
          {wanted > 0 ? `Search ${wanted} Wanted` : 'Search Wanted'}
        </Button>
        <ManualButton versions={versions} text="Manual Search…" name={`Manual search ${title.title}`} onPick={(v) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: v.profileName })} />
      </div>
      <div
        onKeyDown={(e) => {
          // Escape in the field clears it; the panel's own Escape (close) is for when it is empty.
          if (e.key === 'Escape' && find.text !== '') e.stopPropagation()
        }}
      >
        <FindEpisodeField find={find} placeholder="Find an episode: s2e5, 2x05 or a name" />
      </div>
      <ul aria-label="Seasons" className="flex flex-col gap-1">
        {seasons.map((season) => {
          const eps = grouped.get(season) ?? noEpisodes
          const st = seasonStanding(eps, slots)
          const isOpen = open.has(season)
          const Chevron = isOpen ? ChevronDown : ChevronRight
          const name = seasonName(season)
          return (
            <li key={season} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                <Button variant="tertiary" size="small" aria-expanded={isOpen} aria-label={`${name} episodes`} prefix={<Chevron aria-hidden className="size-4" />} onClick={() => toggle(season)}>
                  {name}
                </Button>
                <span className="label-12 hy-num ml-auto text-gray-900">
                  {st.filled} of {st.total}
                </span>
                {st.wanted > 0 && (
                  <Button variant="secondary" size="tiny" aria-label={`Search ${name}`} onClick={() => searchEpisodes(versions, eps, name, () => ({ season }))}>
                    Search {st.wanted}
                  </Button>
                )}
                <ManualButton versions={versions} text="Manual…" name={`Manual search ${name}`} size="tiny" onPick={(v) => manual(v, { season }, name)} />
                <span role="img" aria-label={`${st.filled} of ${st.total} filled`} className="order-last flex w-full flex-wrap items-center gap-1 pl-9">
                  {eps.map((e) => {
                    const dot = dotOf(episodeState(e, slots).state, false)
                    return <StatusDot key={e.id} state={dot.state} variant={dot.variant} label={false} title={null} aria-hidden />
                  })}
                </span>
              </div>
              {isOpen && (
                <Entity.List aria-label={`${name} episodes`}>
                  {eps.map((e) => {
                    const state = episodeState(e, slots)
                    return (
                      <Entity
                        key={e.id}
                        as="li"
                        data-episode={e.id}
                        current={e.id === found}
                        left={<span className="label-12-mono w-10 text-gray-900">{episodeCode(e)}</span>}
                        right={
                          <span className="flex items-center gap-2">
                            <span className={`label-12 ${toneText[state.tone]}`}>{state.text}</span>
                            {wantedIn([e], versions) && <RowButtons actions={{ versions, search: (eps2, label, scope) => searchEpisodes(versions, eps2, label, scope), manual }} episode={e} />}
                          </span>
                        }
                      >
                        <Entity.Content title={<EpisodeName episode={e} />} />
                      </Entity>
                    )
                  })}
                </Entity.List>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
