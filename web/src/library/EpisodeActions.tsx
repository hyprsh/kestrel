// What the episode table can do beyond showing states: Search now and Manual search for an episode, a season or
// the ticked episodes, from visible buttons on each row, above the table and in the bar for ticked episodes;
// monitoring; and Delete files (DeleteFiles.tsx) in the ⋯ menus and the bar.
import { Button, DotsMenu, Menu, MenuButton, MenuContainer, MenuDivider, MenuItem } from '@hyprsh/design'
import { ArrowUpCircle, ListFilter, Search, X, type LucideIcon } from 'lucide-react'
import { useMemo, type FocusEvent, type KeyboardEvent } from 'react'
import { useSearchNow } from '../api/grabs'
import { useMonitorEpisodes, usePatchSeason, useProfiles, type Episode, type EpisodeScope, type TitleDetail } from '../api/queries'
import { useColumnWidths } from '../layout/columnWidths'
import { FloatingBar } from '../layout/FloatingBar'
import { useSelection, type Selection } from '../selection'
import { useReport } from '../toasts'
import { slotLabel, type SlotKey } from './bits'
import { DeleteMenuItems, EpisodeDeleteConfirm, useEpisodeDeletes, type EpisodeDeletes } from './DeleteFiles'
import { episodeCode, episodeRow, seasonName, seasonRow, type EpisodeVersion } from './episodes'
import { IconAction } from './IconAction'
import { TickBox } from './TickBox'
import type { ManualSearchTarget } from './TitleDetail'

type ColumnWidths = ReturnType<typeof useColumnWidths>

const episodeName = (e: Episode) => `Season ${e.season} episode ${e.number}`

export type EpisodeActions = {
  /** The episodes the table shows: those of the open season. Only they can be ticked. */
  shown: Episode[]
  /** The ticked episodes. */
  selection: Selection
  /** The Series' Versions in the table's Slot order. */
  versions: EpisodeVersion[]
  /** Search now in every Slot where one of `eps` is Wanted; `scope` builds each body from that Slot's Wanted ids. */
  search: (eps: Episode[], label: string, scope: (wanted: number[]) => EpisodeScope) => void
  /** Opens Manual search for one Version, narrowed to `body` and named `label`. */
  manual: (v: EpisodeVersion, body: EpisodeScope, label: string) => void
  /** Monitors or unmonitors episodes. */
  monitor: (eps: Episode[], monitored: boolean) => void
  /** Monitors or unmonitors a whole season. */
  monitorSeason: (season: number, monitored: boolean) => void
  /** Delete files of an episode, a season or the ticked episodes, after a confirmation. */
  deletes: EpisodeDeletes
  /**
   * The table's keys for actions: x ticks (X a range), s searches and m opens Manual search for the episode under the cursor
   * (in the Slot of its column, else the first), Shift+F10 or the menu key opens the row's menu, Escape clears the ticks.
   * True when handled.
   */
  onKey: (e: KeyboardEvent, episode: Episode | null, slot: SlotKey | null) => boolean
}

/** The Series' Versions in the table's Slot order, each with its Profile's name. */
export function versionsOf(title: TitleDetail, slots: SlotKey[], profiles: readonly { key: string; name: string }[] | undefined): EpisodeVersion[] {
  const names = new Map((profiles ?? []).map((p) => [p.key, p.name]))
  return slots.flatMap((slot) => {
    const v = title.versions.find((x) => x.slot === slot)
    return v ? [{ id: v.id, slot, profileName: names.get(v.profile) ?? v.profile }] : []
  })
}

/** Search now for episodes of one Series: in every Slot of `versions` where one of `eps` is Wanted, with a Toast saying what came of it. */
export function useEpisodeSearch() {
  const searchNow = useSearchNow()
  const report = useReport()
  return (versions: EpisodeVersion[], eps: Episode[], label: string, scope: (wanted: number[]) => EpisodeScope) => {
    const runs = versions.flatMap((v) => {
      const wanted = eps.filter((e) => e.cells[v.slot]?.state === 'wanted').map((e) => e.id)
      return wanted.length > 0 ? [{ v, scope: scope(wanted) }] : []
    })
    if (runs.length === 0) return
    const where = runs.map((r) => slotLabel[r.v.slot]).join(' and ')
    void report(Promise.all(runs.map((r) => searchNow.mutateAsync({ versionId: r.v.id, scope: r.scope }))), { started: `Search started for ${label} in ${where}`, failed: `Could not search ${label}` })
  }
}

/** The actions of one Series' episode table, with the selection of ticked episodes. Only the episodes of the open season can be ticked: another season's ticks drop, as the Library drops the ticks a filter hides. */
export function useEpisodeActions(title: TitleDetail, episodes: Episode[], shown: Episode[], slots: SlotKey[], onManualSearch?: (t: ManualSearchTarget) => void): EpisodeActions {
  const ids = useMemo(() => shown.map((e) => e.id), [shown])
  const selection = useSelection(ids)
  const profiles = useProfiles()
  const deletes = useEpisodeDeletes(episodes)
  const monitorEpisodes = useMonitorEpisodes(title.id)
  const patchSeason = usePatchSeason(title.id)

  const versions = versionsOf(title, slots, profiles.data)
  const searchEpisodes = useEpisodeSearch()
  const search: EpisodeActions['search'] = (eps, label, scope) => searchEpisodes(versions, eps, label, scope)

  const manual: EpisodeActions['manual'] = (v, body, label) => onManualSearch?.({ versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label } })
  const monitor: EpisodeActions['monitor'] = (eps, monitored) => monitorEpisodes.mutate({ ids: eps.map((e) => e.id), monitored })
  const monitorSeason: EpisodeActions['monitorSeason'] = (season, monitored) => patchSeason.mutate({ season, monitored })

  const onKey: EpisodeActions['onKey'] = (e, episode, slot) => {
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if (e.target instanceof HTMLInputElement && e.target.hasAttribute('data-tick') && (e.key === ' ' || e.key === 'Enter')) {
      e.stopPropagation() // a tick box's own key: it ticks, and the table does not also toggle monitoring
      return true
    }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const row = e.target instanceof Element ? e.target.closest('tr') : null
      row?.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-label^="Actions for"]')?.click()
      return stop()
    }
    if (e.key === 'x' || e.key === 'X') {
      if (episode) selection.toggle(episode.id, { range: e.key === 'X' })
      return stop()
    }
    if (e.key === 's' && episode) {
      search([episode], episodeCode(episode), (ids) => ({ season: episode.season, episode_ids: ids }))
      return stop()
    }
    if (e.key === 'm' && episode) {
      const v = versions.find((x) => x.slot === slot) ?? versions.find((x) => episode.cells[x.slot]?.state === 'wanted') ?? versions[0]
      if (v) manual(v, { season: episode.season, episode_ids: [episode.id] }, episodeCode(episode))
      return stop()
    }
    if (e.key === 'Escape' && selection.active) {
      selection.clear()
      return stop()
    }
    return false
  }

  return { shown, selection, versions, search, manual, monitor, monitorSeason, deletes, onKey }
}

const nothingWanted = 'Nothing here is Wanted'
export const wantedIn = (eps: Episode[], versions: EpisodeVersion[]) => versions.some((v) => eps.some((e) => e.cells[v.slot]?.state === 'wanted'))
const filledIn = (eps: Episode[], versions: EpisodeVersion[]) => versions.filter((v) => eps.some((e) => e.cells[v.slot]?.file))

/** The table keeps one tab stop per row: a row's buttons and menu stay out of the Tab order and pass focus on to the row's cell, where the keyboard was. */
const toRowCell = (e: FocusEvent<HTMLElement>) => e.currentTarget.closest('tr')?.querySelector<HTMLElement>('[data-cell][tabindex="0"]')?.focus()

/** "Manual…": a button that opens Manual search for the one Version, or a menu of the Slots to choose from when there are two. */
export function ManualButton({
  versions,
  text,
  name,
  onPick,
  keyboard = true,
  variant = 'secondary',
  size = 'small',
  icon: Icon,
}: {
  versions: EpisodeVersion[]
  text: string
  /** The accessible name: the text alone does not say what it searches. */
  name: string
  onPick: (v: EpisodeVersion) => void
  /** Whether the button is a tab stop; the episode table's rows reach theirs by key (m) and keep the Tab order short. */
  keyboard?: boolean
  variant?: 'secondary' | 'tertiary'
  size?: 'tiny' | 'small'
  /** Shows this icon instead of `text`; `name` is then the tooltip and the only name. */
  icon?: LucideIcon
}) {
  const tab = keyboard ? undefined : -1
  if (Icon && versions.length === 1)
    return <IconAction icon={Icon} label={name} size={size} variant={variant} tabIndex={tab} onFocus={keyboard ? undefined : toRowCell} onClick={() => onPick(versions[0])} />
  if (versions.length === 1) {
    return (
      <Button variant={variant} size={size} aria-label={name} tabIndex={tab} onFocus={keyboard ? undefined : toRowCell} onClick={() => onPick(versions[0])}>
        {text}
      </Button>
    )
  }
  return (
    <MenuContainer>
      <MenuButton
        variant={variant}
        size={size}
        aria-label={name}
        svgOnly={Icon !== undefined}
        title={Icon ? name : undefined}
        showChevron={false}
        tabIndex={tab}
        onFocus={keyboard ? undefined : toRowCell}
        disabled={versions.length === 0}
      >
        {Icon ? <Icon aria-hidden className="size-3.5" /> : text}
      </MenuButton>
      <Menu>
        {versions.map((v) => (
          <MenuItem key={v.slot} onSelect={() => onPick(v)}>
            {slotLabel[v.slot]}
          </MenuItem>
        ))}
      </Menu>
    </MenuContainer>
  )
}

/**
 * The visible buttons of an episode row: Search, or Upgrade on an episode with a file and nothing Wanted, and Manual….
 * Search now only looks for what is Wanted, so Upgrade opens Manual search on the Slots that hold a file, where a better
 * Release can be picked.
 */
export function RowButtons({ actions, episode }: { actions: Pick<EpisodeActions, 'versions' | 'search' | 'manual'>; episode: Episode }) {
  const { versions } = actions
  const code = episodeCode(episode)
  const scope = { season: episode.season, episode_ids: [episode.id] }
  const wanted = wantedIn([episode], versions)
  const files = filledIn([episode], versions)
  return (
    <span className="flex items-center justify-end gap-1">
      {wanted || files.length === 0 ? (
        <IconAction
          icon={Search}
          label={`Search ${code}`}
          tabIndex={-1}
          onFocus={toRowCell}
          disabled={!wanted}
          onClick={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }))}
        />
      ) : (
        <ManualButton versions={files} text="Upgrade" name={`Upgrade ${code}`} icon={ArrowUpCircle} keyboard={false} size="tiny" variant="tertiary" onPick={(v) => actions.manual(v, scope, code)} />
      )}
      <ManualButton
        versions={versions}
        text="Manual…"
        name={`Manual search ${code}`}
        icon={ListFilter}
        keyboard={false}
        size="tiny"
        variant="tertiary"
        onPick={(v) => actions.manual(v, scope, code)}
      />
    </span>
  )
}

/** The ⋯ menu of one episode row. `onOpenChange` tells the row the menu belongs to when it opens and closes, so the row can show whose menu it is. */
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
      <MenuItem onSelect={() => actions.monitor([episode], !episode.monitored)}>{episode.monitored ? 'Unmonitor' : 'Monitor'}</MenuItem>
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

/**
 * The actions of the open season, in the toolbar above the table: Search season (its Wanted episodes) and the season's ⋯ menu, which
 * holds Manual search season…, Monitor season, Delete season's files and, while the table's column widths differ from the default, Reset column widths.
 */
export function SeasonButtons({ actions, season, episodes, columns }: { actions: EpisodeActions; season: number; episodes: Episode[]; columns?: Pick<ColumnWidths, 'reset' | 'isDefault'> }) {
  const { versions } = actions
  const name = seasonName(season)
  const wanted = wantedIn(episodes, versions)
  const monitored = episodes.some((e) => e.monitored)
  return (
    <>
      <IconAction icon={Search} label={`Search ${name}`} size="small" variant="secondary" disabled={!wanted} onClick={() => actions.search(episodes, name, () => ({ season }))} />
      <DotsMenu aria-label={`Actions for ${name}`} size="small" width={260}>
        {versions.map((v) => (
          <MenuItem key={v.slot} onSelect={() => actions.manual(v, { season }, name)}>
            {versions.length > 1 ? `Manual search season… ${slotLabel[v.slot]}` : 'Manual search season…'}
          </MenuItem>
        ))}
        <MenuItem onSelect={() => actions.monitorSeason(season, !monitored)}>{monitored ? 'Unmonitor season' : 'Monitor season'}</MenuItem>
        <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={episodes} label={name} scope={{ season }} text="Delete season's files" at={seasonRow(season)} />
        {columns && !columns.isDefault && (
          <>
            <MenuDivider />
            <MenuItem onSelect={columns.reset}>Reset column widths</MenuItem>
          </>
        )}
      </DotsMenu>
    </>
  )
}

/** The confirmation of deleting a season's files, under the season's buttons. */
export function SeasonDeleteConfirm({ actions, season }: { actions: EpisodeActions; season: number }) {
  return <EpisodeDeleteConfirm deletes={actions.deletes} at={seasonRow(season)} />
}

/** A row's tick box. */
export function EpisodeTick({ actions, episode, tabIndex, onFocus, cell }: { actions: EpisodeActions; episode: Episode; tabIndex: number; onFocus: () => void; cell: string }) {
  return <TickBox selection={actions.selection} id={episode.id} name={episodeName(episode)} cell={cell} tabIndex={tabIndex} onFocus={onFocus} />
}

/** The floating bar for the ticked episodes: Search Now, Manual Search…, Unmonitor, a menu with Delete files and Clear; a deletion's confirmation shows above it. */
export function TickedBar({ actions }: { actions: EpisodeActions }) {
  const { selection, shown, versions } = actions
  const ticked = shown.filter((e) => selection.has(e.id))
  if (ticked.length === 0 && actions.deletes.pending?.at !== null) return null
  const wanted = wantedIn(ticked, versions)
  const label = ticked.length === 1 ? episodeCode(ticked[0]) : `${ticked.length} episodes`
  const monitored = ticked.some((e) => e.monitored)
  const season = ticked[0]?.season
  return (
    <FloatingBar label={`${label} ticked`} placement="sticky">
      <EpisodeDeleteConfirm deletes={actions.deletes} />
      <span className="label-13 mr-1.5">{selection.count} ticked</span>
      <Button variant="primary" size="small" disabled={!wanted} title={wanted ? undefined : nothingWanted} onClick={() => actions.search(ticked, label, (ids) => ({ episode_ids: ids }))}>
        Search Now
      </Button>
      <ManualButton versions={versions} text="Manual Search…" name={`Manual search ${label}`} onPick={(v) => actions.manual(v, { season, episode_ids: ticked.map((e) => e.id) }, label)} />
      <Button variant="secondary" size="small" onClick={() => actions.monitor(ticked, !monitored)}>
        {monitored ? 'Unmonitor' : 'Monitor'}
      </Button>
      <DotsMenu aria-label="More actions for the ticked episodes" size="small">
        <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={ticked} label={label} scope={{ episode_ids: ticked.map((e) => e.id) }} text="Delete files" at={null} />
      </DotsMenu>
      <Button variant="tertiary" size="small" aria-label="Clear ticks" prefix={<X aria-hidden className="size-4" />} onClick={selection.clear} />
    </FloatingBar>
  )
}
