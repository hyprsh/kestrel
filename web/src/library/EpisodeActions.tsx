// What the season table can do beyond showing states: Search now for an episode, a season or the ticked episodes (a cell's menu, the
// row's ⋯ menu or the bar), monitoring from the ⋯ menus and the bar's Monitor and Stop Monitoring, Manual search in a cell's menu or the
// bar, and Delete files (DeleteFiles.tsx) in the ⋯ menus of an episode, a season and the bar.
import { ActionBar, Button, DotsMenu, Menu, MenuButton, MenuContainer, MenuDivider, MenuItem, termText } from '@hyprsh/design'
import { ArrowUpCircle, Bookmark, BookmarkCheck, ListChecks, ListFilter, ScrollText, Search, type LucideIcon } from 'lucide-react'
import { useMemo, type FocusEvent, type KeyboardEvent } from 'react'
import { useSearchNow } from '../api/grabs'
import { useMonitorEpisodes, usePatchSeason, useProfiles, type Episode, type EpisodeScope, type TitleDetail } from '../api/queries'
import { placePath, useOpenPlace } from '../place'
import { useSelection, type Selection } from '../selection'
import { useReport } from '../toasts'
import { DeleteMenuItems, EpisodeDeleteConfirm, useEpisodeDeletes, type EpisodeDeletes } from './DeleteFiles'
import { IconAction } from './IconAction'
import { episodeCode, episodeRow, seasonName, seasonRow, type EpisodeVersion } from './episodes'
import { cellOf, useSlotNames, type SlotNames } from './slots'
import { TickBox } from './TickBox'
import { scopeCode } from './scopeCode'
import type { ManualSearchTarget } from './TitleDetail'

const episodeName = (e: Episode) => `Season ${e.season} episode ${e.number}`

export type EpisodeActions = {
  /** The episodes the table shows: those of the open season. Only they can be ticked. */
  shown: Episode[]
  /** The ticked episodes. */
  selection: Selection
  /** The Series' Versions in the table's Slot order. */
  versions: EpisodeVersion[]
  /** Search now in every Slot where one of `eps` is Wanted (or only in the Slot `only` names); `scope` builds each body from that Slot's Wanted ids. */
  search: (eps: Episode[], label: string, scope: (wanted: number[]) => EpisodeScope, only?: string) => void
  /** The automatic Upgrade search for one episode in one Version: it grabs only a Release the Profile ranks above the file held. */
  upgrade: (v: EpisodeVersion, episode: Episode) => void
  /** Opens Manual search for one Version, narrowed to `body` and named `label`. */
  manual: (v: EpisodeVersion, body: EpisodeScope, label: string) => void
  /** Monitors or unmonitors episodes. */
  monitor: (eps: Episode[], monitored: boolean) => void
  /** Monitors or unmonitors a whole season. */
  monitorSeason: (season: number, monitored: boolean) => void
  /** Opens the Log on this Series. */
  showInLog: () => void
  /** Delete files of an episode, a season or the ticked episodes, after a confirmation. */
  deletes: EpisodeDeletes
  /**
   * The list's keys for actions: x ticks (X a range), s searches and m opens Manual search for the episode under the cursor
   * (in its first Wanted Slot), Shift+F10 or the menu key opens the menu of a row, Escape clears the ticks.
   * True when handled.
   */
  onKey: (e: KeyboardEvent, episode: Episode | null) => boolean
}

/** The Series' Versions in the table's Slot order, each with its Profile's name. */
export function versionsOf(title: TitleDetail, slots: readonly string[], profiles: readonly { key: string; name: string }[] | undefined, slotNames: SlotNames): EpisodeVersion[] {
  const names = new Map((profiles ?? []).map((p) => [p.key, p.name]))
  return slots.flatMap((slot) => {
    const v = title.versions.find((x) => x.slot === slot)
    return v ? [{ id: v.id, slot, slotName: slotNames.name(slot), profileName: names.get(v.profile) ?? v.profile }] : []
  })
}

/** Search now for episodes of one Series: in every Slot of `versions` where one of `eps` is Wanted, with a Toast saying what came of it. */
export function useEpisodeSearch() {
  const searchNow = useSearchNow()
  const report = useReport()
  return (versions: EpisodeVersion[], eps: Episode[], label: string, scope: (wanted: number[]) => EpisodeScope, only?: string) => {
    const runs = versions
      .filter((v) => only === undefined || v.slot === only)
      .flatMap((v) => {
        const wanted = eps.filter((e) => cellOf(e, v.slot)?.state === 'wanted').map((e) => e.id)
        return wanted.length > 0 ? [{ v, scope: scope(wanted) }] : []
      })
    if (runs.length === 0) return
    const where = runs.map((r) => r.v.slotName).join(' and ')
    void report(Promise.all(runs.map((r) => searchNow.mutateAsync({ versionId: r.v.id, scope: r.scope, watch: { what: `${label} in ${r.v.slotName}`, scope: scopeCode(r.scope, eps) } }))), {
      started: `Search started for ${label} in ${where}`,
      failed: `Could not search ${label}`,
    })
  }
}

/** Search now for an Upgrade of one episode in one Version, with a Toast that says it started, or that there is nothing to upgrade. What the indexers had to offer reaches the Log. */
export function useEpisodeUpgrade() {
  const searchNow = useSearchNow()
  const report = useReport()
  return (v: EpisodeVersion, episode: Episode) => {
    const code = episodeCode(episode)
    const why = episode.monitored ? 'it is at its Cutoff or already downloading' : 'it is not monitored'
    void report(searchNow.mutateAsync({ versionId: v.id, scope: { season: episode.season, episode_ids: [episode.id] }, upgrade: true, watch: { what: `${code} in ${v.slotName}`, scope: code } }), {
      started: (r) => (r.started ? `Upgrade search started for ${code} in ${v.slotName}` : ''),
      done: `Nothing to upgrade for ${code} in ${v.slotName}: ${why}`,
      failed: `Could not search for an Upgrade of ${code}`,
    })
  }
}

/** The actions of one Series' episode table, with the selection of ticked episodes. Only the episodes of the open season can be ticked: another season's ticks drop, as the Library drops the ticks a filter hides. */
export function useEpisodeActions(title: TitleDetail, episodes: Episode[], shown: Episode[], slots: readonly string[], onManualSearch?: (t: ManualSearchTarget) => void): EpisodeActions {
  const ids = useMemo(() => shown.map((e) => e.id), [shown])
  const selection = useSelection(ids)
  const profiles = useProfiles()
  const slotNames = useSlotNames()
  const deletes = useEpisodeDeletes(episodes)
  const monitorEpisodes = useMonitorEpisodes(title.id)
  const patchSeason = usePatchSeason(title.id)
  const openPlace = useOpenPlace()

  const versions = versionsOf(title, slots, profiles.data, slotNames)
  const searchEpisodes = useEpisodeSearch()
  const upgrade = useEpisodeUpgrade()
  const search: EpisodeActions['search'] = (eps, label, scope, only) => searchEpisodes(versions, eps, label, scope, only)

  const manual: EpisodeActions['manual'] = (v, body, label) => onManualSearch?.({ versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label, code: scopeCode(body, episodes) } })
  const monitor: EpisodeActions['monitor'] = (eps, monitored) => monitorEpisodes.mutate({ ids: eps.map((e) => e.id), monitored })
  const monitorSeason: EpisodeActions['monitorSeason'] = (season, monitored) => patchSeason.mutate({ season, monitored })

  const showInLog = () => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))

  const onKey: EpisodeActions['onKey'] = (e, episode) => {
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
      const row = e.target instanceof Element ? e.target.closest('[data-row]') : null
      row?.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-label$=" Actions"]')?.click()
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
      const v = versions.find((x) => cellOf(episode, x.slot)?.state === 'wanted') ?? versions[0]
      if (v) manual(v, { season: episode.season, episode_ids: [episode.id] }, episodeCode(episode))
      return stop()
    }
    if (e.key === 'Escape' && selection.active) {
      selection.clear()
      return stop()
    }
    return false
  }

  return { shown, selection, versions, search, upgrade, manual, monitor, monitorSeason, showInLog, deletes, onKey }
}

const filledIn = (eps: Episode[], versions: EpisodeVersion[]) => versions.filter((v) => eps.some((e) => cellOf(e, v.slot)?.file))

const nothingWanted = 'Nothing here is Wanted'
export const wantedIn = (eps: Episode[], versions: EpisodeVersion[]) => versions.some((v) => eps.some((e) => cellOf(e, v.slot)?.state === 'wanted'))

/** The list keeps one tab stop per row: a row's menu stays out of the Tab order and passes focus on to the row itself. */
const toRowCell = (e: FocusEvent<HTMLElement>) => e.currentTarget.closest<HTMLElement>('[data-row]')?.focus()

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
            {v.slotName}
          </MenuItem>
        ))}
      </Menu>
    </MenuContainer>
  )
}

/**
 * The visible buttons of an episode row: Search, or Upgrade on an episode with a file and nothing Wanted, and Manual….
 * Search now looks for what is Wanted; Upgrade runs the automatic Upgrade search on the Slots that hold a file, which grabs
 * only a better Release. Manual… is where a Release is picked by hand.
 */
export function RowButtons({ actions, episode }: { actions: Pick<EpisodeActions, 'versions' | 'search' | 'upgrade' | 'manual'>; episode: Episode }) {
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
          reason={wanted ? undefined : nothingWanted}
          onClick={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }))}
        />
      ) : (
        <ManualButton versions={files} text="Upgrade" name={`Upgrade ${code}`} icon={ArrowUpCircle} keyboard={false} size="tiny" variant="tertiary" onPick={(v) => actions.upgrade(v, episode)} />
      )}
      <ManualButton
        versions={versions}
        text="Manual…"
        name={`Manual Search ${code}`}
        icon={ListFilter}
        keyboard={false}
        size="tiny"
        variant="tertiary"
        onPick={(v) => actions.manual(v, scope, code)}
      />
    </span>
  )
}

/** The "Manual Search…" items of a menu: one for a single Version, one per Slot when the Series has both ("Manual Search 4K…"). */
function ManualItems({ versions, text = 'Manual Search', onPick }: { versions: EpisodeVersion[]; text?: string; onPick: (v: EpisodeVersion) => void }) {
  return versions.map((v) => (
    <MenuItem key={v.slot} prefix={<ListFilter aria-hidden className="size-4" />} onSelect={() => onPick(v)}>
      {versions.length > 1 ? `${text} ${v.slotName}…` : `${text}…`}
    </MenuItem>
  ))
}

/**
 * The ⋯ menu of an episode row: Search All Versions (what is Wanted in it, in every Version), Stop Monitoring Episode (Monitor Episode
 * while it is not) and the delete items of its files. A Version's own search and files are its cell's menu.
 */
export function EpisodeMenu({ actions, episode, onOpenChange }: { actions: EpisodeActions; episode: Episode; onOpenChange?: (open: boolean) => void }) {
  const { versions } = actions
  const code = episodeCode(episode)
  const wanted = wantedIn([episode], versions)
  return (
    <DotsMenu aria-label={`${code} Actions`} size="tiny" iconSize={12} tabIndex={-1} onFocus={toRowCell} onOpenChange={onOpenChange} width={240}>
      <MenuItem
        prefix={<Search aria-hidden className="size-4" />}
        disabled={!wanted}
        description={wanted ? undefined : nothingWanted}
        onSelect={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }))}
      >
        Search All Versions
      </MenuItem>
      <MenuItem
        prefix={episode.monitored ? <Bookmark aria-hidden className="size-4" /> : <BookmarkCheck aria-hidden className="size-4" />}
        onSelect={() => actions.monitor([episode], !episode.monitored)}
      >
        {episode.monitored ? 'Stop Monitoring Episode' : 'Monitor Episode'}
      </MenuItem>
      <MenuItem prefix={<ScrollText aria-hidden className="size-4" />} onSelect={actions.showInLog}>
        Show in Log
      </MenuItem>
      <MenuDivider />
      <DeleteMenuItems
        deletes={actions.deletes}
        versions={versions}
        episodes={[episode]}
        label={code}
        scope={{ season: episode.season, episode_ids: [episode.id] }}
        text="Files"
        at={episodeRow(episode.id)}
      />
    </DotsMenu>
  )
}

/**
 * A season row's ⋯ menu, season-wide: Search All Wanted in Season N, Select All Episodes (it opens the season, `onSelectAll`), Stop
 * Monitoring Season N (Monitor while it is not) and the delete items of its files. A Version's own actions are its cell's menu.
 */
export function SeasonMenu({ actions, season, episodes, monitored, onSelectAll }: { actions: EpisodeActions; season: number; episodes: Episode[]; monitored: boolean; onSelectAll: () => void }) {
  const { versions, selection } = actions
  const name = seasonName(season)
  const wanted = wantedIn(episodes, versions)
  const all = episodes.length > 0 && episodes.every((e) => selection.has(e.id))
  return (
    <DotsMenu aria-label={`${name} Actions`} size="small" width={260}>
      <MenuItem
        prefix={<Search aria-hidden className="size-4" />}
        disabled={!wanted}
        description={wanted ? undefined : nothingWanted}
        onSelect={() => actions.search(episodes, name, () => ({ season }))}
      >
        {`Search All Wanted in ${name}`}
      </MenuItem>
      <MenuItem prefix={<ListChecks aria-hidden className="size-4" />} disabled={episodes.length === 0} onSelect={() => (all ? selection.clear() : onSelectAll())}>
        {all ? 'Deselect All Episodes' : 'Select All Episodes'}
      </MenuItem>
      <MenuItem prefix={monitored ? <Bookmark aria-hidden className="size-4" /> : <BookmarkCheck aria-hidden className="size-4" />} onSelect={() => actions.monitorSeason(season, !monitored)}>
        {monitored ? `Stop Monitoring ${name}` : `Monitor ${name}`}
      </MenuItem>
      <MenuDivider />
      <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={episodes} label={name} scope={{ season }} text="Season's Files" at={seasonRow(season)} />
    </DotsMenu>
  )
}

/** A row's tick box. */
export function EpisodeTick({ actions, episode, tabIndex, onFocus }: { actions: EpisodeActions; episode: Episode; tabIndex: number; onFocus: () => void }) {
  return <TickBox selection={actions.selection} id={episode.id} name={episodeName(episode)} tabIndex={tabIndex} onFocus={onFocus} />
}

/**
 * The ActionBar for the ticked episodes: "N selected" with its ×, and Select All, then Search and a ⋯ menu (Manual Search…,
 * Delete Files…), with Monitor and Stop Monitoring as its quiet actions; a deletion's confirmation shows above it.
 */
export function TickedBar({ actions }: { actions: EpisodeActions }) {
  const { selection, shown, versions } = actions
  const ticked = shown.filter((e) => selection.has(e.id))
  const wanted = wantedIn(ticked, versions)
  const label = ticked.length === 1 ? episodeCode(ticked[0]) : `${ticked.length} episodes`
  const season = ticked[0]?.season
  return (
    <>
      <EpisodeDeleteConfirm deletes={actions.deletes} />
      <ActionBar
        open={ticked.length > 0}
        selection={{ count: selection.count, total: shown.length, onSelectAll: selection.checkAll, onClear: selection.clear }}
        secondaryActions={[
          { label: 'Monitor', disabled: ticked.every((e) => e.monitored), onSelect: () => actions.monitor(ticked, true) },
          { label: 'Stop Monitoring', disabled: ticked.every((e) => !e.monitored), onSelect: () => actions.monitor(ticked, false) },
        ]}
        actions={
          <>
            <Button variant="primary" size="small" disabled={!wanted} title={wanted ? undefined : nothingWanted} onClick={() => actions.search(ticked, label, (ids) => ({ episode_ids: ids }))}>
              Search
            </Button>
            <DotsMenu aria-label="More actions for the selected episodes" size="small" position="top-end" width={240}>
              <ManualItems versions={versions} onPick={(v) => actions.manual(v, { season, episode_ids: ticked.map((e) => e.id) }, label)} />
              <MenuDivider />
              <DeleteMenuItems deletes={actions.deletes} versions={versions} episodes={ticked} label={label} scope={{ episode_ids: ticked.map((e) => e.id) }} text="Files" at={null} />
            </DotsMenu>
          </>
        }
      />
    </>
  )
}
