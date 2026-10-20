// What the episode grid can do beyond monitoring: Search now and Manual search
// for an episode, a season or the ticked episodes, from each row's menu and
// the selection bar, and Delete files (DeleteFiles.tsx) in the same menus and bar.
import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useSearchNow, type ReleaseScope } from '../api/grabs'
import { useProfiles, type Episode, type TitleDetail } from '../api/queries'
import { Button } from '../forms'
import { Menu, MenuItem } from '../menu'
import { SelectBox, SelectionBar, useSelection, type Selection } from '../selection'
import { cx } from '../ui'
import { slotLabel, type SlotKey } from './bits'
import { DeleteMenuItems, DeleteTickedButtons, EpisodeDeleteConfirm, useEpisodeDeletes, type EpisodeDeletes } from './DeleteFiles'
import type { ManualSearchTarget } from './TitleDetail'

const two = (n: number) => String(n).padStart(2, '0')
/** "S01E03": how an episode reads in a scope label. */
export const episodeCode = (e: Episode) => `S${two(e.season)}E${two(e.number)}`
const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)
const episodeName = (e: Episode) => `Season ${e.season} episode ${e.number}`

type Version = { id: number; slot: SlotKey; profileName: string }

export type EpisodeActions = {
  /** The ticked episodes. */
  selection: Selection
  /** The Series' Versions in the grid's Slot order. */
  versions: Version[]
  /** Search now in every Slot where one of `eps` is Wanted; `scope` builds each body from that Slot's Wanted ids. */
  search: (eps: Episode[], label: string, scope: (wanted: number[]) => ReleaseScope) => void
  /** Opens Manual search for one Version, narrowed to `body` and named `label`. */
  manual: (v: Version, body: ReleaseScope, label: string) => void
  /** Delete files of an episode, a season or the ticked episodes, after a confirmation. */
  deletes: EpisodeDeletes
  /** What the last Search now or deletion said. */
  status: { text: string; error: boolean } | null
  /** The grid's keys for actions: x ticks (X a range), Shift+F10 or the menu key opens the row's menu, Escape clears the ticks. True when handled. */
  onKey: (e: KeyboardEvent, episode: Episode | null) => boolean
}

/** The actions of one Series' episode grid, with the selection of ticked episodes. */
export function useEpisodeActions(title: TitleDetail, episodes: Episode[], slots: SlotKey[], onManualSearch?: (t: ManualSearchTarget) => void): EpisodeActions {
  const ids = useMemo(() => episodes.map((e) => e.id), [episodes])
  const selection = useSelection(ids)
  const profiles = useProfiles()
  const searchNow = useSearchNow()
  const [status, setStatus] = useState<EpisodeActions['status']>(null)
  const deletes = useEpisodeDeletes(episodes, setStatus)

  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  const versions: Version[] = slots.flatMap((slot) => {
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
    setStatus({ text: `Searching ${label} in ${where}… The Log shows what it grabs.`, error: false })
    Promise.all(runs.map((r) => searchNow.mutateAsync({ versionId: r.v.id, scope: r.scope }))).catch((err: Error) =>
      setStatus({ text: `Could not search ${label}: ${err.message}`, error: true }),
    )
  }

  const manual: EpisodeActions['manual'] = (v, body, label) => onManualSearch?.({ versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label } })

  const onKey: EpisodeActions['onKey'] = (e, episode) => {
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if (e.target instanceof HTMLInputElement && (e.key === ' ' || e.key === 'Enter')) {
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

  return { selection, versions, search, manual, deletes, status, onKey }
}

const nothingWanted = 'Nothing here is Wanted'
const wantedIn = (eps: Episode[], versions: Version[]) => versions.some((v) => eps.some((e) => e.cells[v.slot]?.state === 'wanted'))
const menuButton = { trigger: <MoreHorizontal className="size-3.5" />, buttonTabIndex: -1, buttonClassName: 'size-5' }

/** The ⋯ menu of one episode row. */
export function EpisodeMenu({ actions, episode }: { actions: EpisodeActions; episode: Episode }) {
  const { selection, versions } = actions
  const code = episodeCode(episode)
  const wanted = wantedIn([episode], versions)
  return (
    <Menu label={`Actions for ${episodeName(episode)}`} {...menuButton}>
      <MenuItem disabled={!wanted} hint={wanted ? undefined : nothingWanted} onSelect={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }))}>
        Search
      </MenuItem>
      {versions.map((v) => (
        <MenuItem key={v.slot} onSelect={() => actions.manual(v, { season: episode.season, episode_ids: [episode.id] }, code)}>
          {versions.length > 1 ? `Manual search ${slotLabel[v.slot]}` : 'Manual search'}
        </MenuItem>
      ))}
      <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={[episode]} label={code} scope={{ season: episode.season, episode_ids: [episode.id] }} text="Delete file" />
      <MenuItem onSelect={() => selection.toggle(episode.id)}>{selection.has(episode.id) ? 'Untick' : 'Tick'}</MenuItem>
    </Menu>
  )
}

/** The ⋯ menu of a season row. */
export function SeasonMenu({ actions, season, episodes }: { actions: EpisodeActions; season: number; episodes: Episode[] }) {
  const { versions } = actions
  const name = seasonName(season)
  const wanted = wantedIn(episodes, versions)
  return (
    <Menu label={`Actions for ${name}`} {...menuButton}>
      <MenuItem disabled={!wanted} hint={wanted ? undefined : nothingWanted} onSelect={() => actions.search(episodes, name, () => ({ season }))}>
        Search season
      </MenuItem>
      {versions.map((v) => (
        <MenuItem key={v.slot} onSelect={() => actions.manual(v, { season }, name)}>
          {versions.length > 1 ? `Manual search season ${slotLabel[v.slot]}` : 'Manual search season'}
        </MenuItem>
      ))}
      <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={episodes} label={name} scope={{ season }} text="Delete season's files" />
    </Menu>
  )
}

/** An episode row's tick box, shown while episodes are being ticked. */
export function EpisodeTick({ actions, episode }: { actions: EpisodeActions; episode: Episode }) {
  return actions.selection.active ? <SelectBox selection={actions.selection} id={episode.id} name={episodeName(episode)} /> : null
}

/** Above the grid: the ticked episodes' actions and what the last Search now said. */
export function EpisodeToolbar({ actions, episodes }: { actions: EpisodeActions; episodes: Episode[] }) {
  const { selection, status } = actions
  const ticked = episodes.filter((e) => selection.has(e.id))
  const wanted = wantedIn(ticked, actions.versions)
  const label = ticked.length === 1 ? episodeCode(ticked[0]) : `${ticked.length} episodes`
  return (
    <div className={cx('flex flex-col gap-1', (selection.active || status || actions.deletes.pending) && 'mb-2')}>
      <SelectionBar selection={selection} shown={episodes.length}>
        <Button
          variant="secondary"
          className="h-6 px-2 text-[12px]"
          disabled={!wanted}
          title={wanted ? undefined : nothingWanted}
          onClick={() => actions.search(ticked, label, (ids) => ({ episode_ids: ids }))}
        >
          Search
        </Button>
        <DeleteTickedButtons deletes={actions.deletes} versions={actions.versions} ticked={ticked} label={label} />
      </SelectionBar>
      <EpisodeDeleteConfirm deletes={actions.deletes} />
      <p role="status" className={cx('text-[12px] empty:hidden', status?.error ? 'text-red-900' : 'text-gray-900')}>
        {status?.text}
      </p>
    </div>
  )
}
