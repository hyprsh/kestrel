// What the episode grid can do beyond monitoring: Search now and Manual search
// for an episode, a season or the ticked episodes, from each row's menu and
// the selection bar, and Delete files (DeleteFiles.tsx) in the same menus and bar.
import { useMemo, type FocusEvent, type KeyboardEvent } from 'react'
import { useSearchNow } from '../api/grabs'
import { useReport } from '../toasts'
import { useProfiles, type Episode, type EpisodeScope, type TitleDetail } from '../api/queries'
import { Button, DotsMenu, MenuItem } from '@hyprsh/design'
import { SelectionBar } from '../layout/SelectionBar'
import { useSelection, type Selection } from '../selection'
import { cx } from '../ui'
import { slotLabel, type SlotKey } from './bits'
import { episodeCode, episodeRow, seasonName, seasonRow, type EpisodeVersion } from './episodes'
import { DeleteMenuItems, DeleteTickedButtons, EpisodeDeleteConfirm, useEpisodeDeletes, type EpisodeDeletes } from './DeleteFiles'
import { TickBox } from './TickBox'
import type { ManualSearchTarget } from './TitleDetail'
import type { SeasonOpen } from './useSeasonOpen'

const episodeName = (e: Episode) => `Season ${e.season} episode ${e.number}`

export type EpisodeActions = {
  /** The episodes the grid shows: those of the open seasons. Only they can be ticked. */
  shown: Episode[]
  /** The ticked episodes. */
  selection: Selection
  /** The Series' Versions in the grid's Slot order. */
  versions: EpisodeVersion[]
  /** Search now in every Slot where one of `eps` is Wanted; `scope` builds each body from that Slot's Wanted ids. */
  search: (eps: Episode[], label: string, scope: (wanted: number[]) => EpisodeScope) => void
  /** Opens Manual search for one Version, narrowed to `body` and named `label`. */
  manual: (v: EpisodeVersion, body: EpisodeScope, label: string) => void
  /** Delete files of an episode, a season or the ticked episodes, after a confirmation. */
  deletes: EpisodeDeletes
  /** The grid's keys for actions: x ticks (X a range), Shift+F10 or the menu key opens the row's menu, Escape clears the ticks. True when handled. */
  onKey: (e: KeyboardEvent, episode: Episode | null) => boolean
}

/**
 * The actions of one Series' episode grid, with the selection of ticked
 * episodes. Only the episodes of open seasons can be ticked, as only they are
 * shown: closing a season drops its ticks, as the Library drops the ticks a
 * filter hides.
 */
export function useEpisodeActions(title: TitleDetail, episodes: Episode[], seasons: SeasonOpen, slots: SlotKey[], onManualSearch?: (t: ManualSearchTarget) => void): EpisodeActions {
  const shown = useMemo(() => episodes.filter((e) => seasons.isOpen(e.season)), [episodes, seasons])
  const ids = useMemo(() => shown.map((e) => e.id), [shown])
  const selection = useSelection(ids)
  const profiles = useProfiles()
  const searchNow = useSearchNow()
  const report = useReport()
  const deletes = useEpisodeDeletes(episodes)

  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  const versions: EpisodeVersion[] = slots.flatMap((slot) => {
    const v = title.versions.find((x) => x.slot === slot)
    return v ? [{ id: v.id, slot, profileName: names.get(v.profile) ?? v.profile }] : []
  })

  const search: EpisodeActions['search'] = (eps, label, scope) => {
    const runs = versions.flatMap((v) => {
      const wanted = eps.filter((e) => e.cells[v.slot]?.state === 'wanted').map((e) => e.id)
      return wanted.length > 0 ? [{ v, scope: scope(wanted) }] : []
    })
    if (runs.length === 0) return
    const where = runs.map((r) => slotLabel[r.v.slot]).join(' and ')
    void report(Promise.all(runs.map((r) => searchNow.mutateAsync({ versionId: r.v.id, scope: r.scope }))), { started: `Search started for ${label} in ${where}`, failed: `Could not search ${label}` })
  }

  const manual: EpisodeActions['manual'] = (v, body, label) => onManualSearch?.({ versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label } })

  const onKey: EpisodeActions['onKey'] = (e, episode) => {
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if (e.target instanceof HTMLInputElement && e.target.hasAttribute('data-tick') && (e.key === ' ' || e.key === 'Enter')) {
      e.stopPropagation() // a tick box's own key: it ticks, and the grid does not also toggle monitoring
      return true
    }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const row = e.target instanceof Element ? e.target.closest('[role="row"]') : null
      row?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.click()
      return stop()
    }
    if (e.key === 'x' || e.key === 'X') {
      // On a season row x does nothing, but the Library's own x (tick the Title) must not fire either.
      if (episode) selection.toggle(episode.id, { range: e.key === 'X' })
      return stop()
    }
    if (e.key === 'Escape' && selection.active) {
      selection.clear()
      return stop()
    }
    return false
  }

  return { shown, selection, versions, search, manual, deletes, onKey }
}

const nothingWanted = 'Nothing here is Wanted'
const wantedIn = (eps: Episode[], versions: EpisodeVersion[]) => versions.some((v) => eps.some((e) => e.cells[v.slot]?.state === 'wanted'))

/** The grid has a roving focus: a row menu's button stays out of the Tab order and passes focus on to the row's cell, where the keyboard was. */
const toRowCell = (e: FocusEvent<HTMLButtonElement>) => e.currentTarget.closest('[role="row"]')?.querySelector<HTMLElement>('[data-cell][tabindex="0"]')?.focus()

/** The ⋯ menu of one episode row. */
/** `onOpenChange` tells the row the menu belongs to when it opens and closes, so the row can show whose menu it is. */
export function EpisodeMenu({ actions, episode, onOpenChange }: { actions: EpisodeActions; episode: Episode; onOpenChange?: (open: boolean) => void }) {
  const { selection, versions } = actions
  const code = episodeCode(episode)
  const wanted = wantedIn([episode], versions)
  return (
    <DotsMenu aria-label={`Actions for ${episodeName(episode)}`} size="tiny" iconSize={12} tabIndex={-1} onFocus={toRowCell} onOpenChange={onOpenChange}>
      <MenuItem disabled={!wanted} description={wanted ? undefined : nothingWanted} onSelect={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }))}>
        Search
      </MenuItem>
      {versions.map((v) => (
        <MenuItem key={v.slot} onSelect={() => actions.manual(v, { season: episode.season, episode_ids: [episode.id] }, code)}>
          {versions.length > 1 ? `Manual search ${slotLabel[v.slot]}` : 'Manual search'}
        </MenuItem>
      ))}
      <DeleteMenuItems
        deletes={actions.deletes}
        versions={versions}
        episodes={[episode]}
        label={code}
        scope={{ season: episode.season, episode_ids: [episode.id] }}
        text="Delete file"
        at={episodeRow(episode.id)}
      />
      <MenuItem onSelect={() => selection.toggle(episode.id)}>{selection.has(episode.id) ? 'Untick' : 'Tick'}</MenuItem>
    </DotsMenu>
  )
}

/** The ⋯ menu of a season row. */
export function SeasonMenu({ actions, season, episodes, onOpenChange }: { actions: EpisodeActions; season: number; episodes: Episode[]; onOpenChange?: (open: boolean) => void }) {
  const { versions } = actions
  const name = seasonName(season)
  const wanted = wantedIn(episodes, versions)
  return (
    <DotsMenu aria-label={`Actions for ${name}`} size="tiny" iconSize={12} tabIndex={-1} onFocus={toRowCell} onOpenChange={onOpenChange}>
      <MenuItem disabled={!wanted} description={wanted ? undefined : nothingWanted} onSelect={() => actions.search(episodes, name, () => ({ season }))}>
        Search season
      </MenuItem>
      {versions.map((v) => (
        <MenuItem key={v.slot} onSelect={() => actions.manual(v, { season }, name)}>
          {versions.length > 1 ? `Manual search season ${slotLabel[v.slot]}` : 'Manual search season'}
        </MenuItem>
      ))}
      <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={episodes} label={name} scope={{ season }} text="Delete season's files" at={seasonRow(season)} />
    </DotsMenu>
  )
}

/** An episode row's tick box, shown while episodes are being ticked. */
export function EpisodeTick({ actions, episode }: { actions: EpisodeActions; episode: Episode }) {
  return actions.selection.active ? <TickBox selection={actions.selection} id={episode.id} name={episodeName(episode)} /> : null
}

/** Above the grid: the ticked episodes' actions and their deletion's confirmation. */
export function EpisodeToolbar({ actions }: { actions: EpisodeActions }) {
  const { selection, shown } = actions
  const ticked = shown.filter((e) => selection.has(e.id))
  const wanted = wantedIn(ticked, actions.versions)
  const label = ticked.length === 1 ? episodeCode(ticked[0]) : `${ticked.length} episodes`
  return (
    <div className={cx('flex flex-col gap-1', (selection.active || actions.deletes.pending?.at === null) && 'mb-2')}>
      <SelectionBar selection={selection} shown={shown.length}>
        <Button variant="secondary" size="small" disabled={!wanted} title={wanted ? undefined : nothingWanted} onClick={() => actions.search(ticked, label, (ids) => ({ episode_ids: ids }))}>
          Search
        </Button>
        <DeleteTickedButtons deletes={actions.deletes} versions={actions.versions} ticked={ticked} label={label} />
      </SelectionBar>
      <EpisodeDeleteConfirm deletes={actions.deletes} />
    </div>
  )
}
