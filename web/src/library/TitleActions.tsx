// The Title page's header controls: one primary Search button with its dropdown, and the Title "…" menu. Monitoring
// has a quiet dropdown on the meta line and the menu's Monitoring… item; what the rarer items open (the Root folder
// picker, the removal confirmation, Add Version) shows in a Modal.
import { useState } from 'react'
import type { Profile, SeriesMonitor, TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen, useSetMovieMonitored, useSetSeriesMonitor } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { BrushCleaning, Eye, FolderInput, Plus, RefreshCw, ScrollText, Snowflake, Trash2 } from 'lucide-react'
import { DotsMenu, Menu, MenuDivider, MenuItem, MenuSection, Modal, Radio, SplitButton, termText } from '@hyprsh/design'
import { placePath, useOpenPlace } from '../place'
import { useReport } from '../toasts'
import { externalIdItems } from './ExternalIds'
import { AddVersion, RemoveTitle } from './ManageVersion'
import { MoveTitle } from './MoveTitle'
import { slotLabel } from './bits'
import type { ManualSearchTarget } from './TitleDetail'
import { useSearchWanted } from './VersionSearch'

const NOT_MONITORED_SEARCH = 'Not monitored: turn monitoring on to search'

type Mode = 'monitored' | 'unmonitored' | SeriesMonitor

/** The monitoring choices of a Title, in menu order, with the label the meta line shows for each. */
function choices(title: TitleDetail): { value: Mode; label: string }[] {
  return title.kind === 'movie'
    ? [
        { value: 'monitored', label: 'Monitored' },
        { value: 'unmonitored', label: 'Not monitored' },
      ]
    : [
        { value: 'all', label: 'Monitoring all episodes' },
        { value: 'future', label: 'Monitoring future episodes' },
        { value: 'none', label: 'Not monitored' },
      ]
}

const modeOf = (title: TitleDetail): Mode => (title.kind === 'movie' ? (title.monitored ? 'monitored' : 'unmonitored') : (title.series_monitor ?? 'all'))

/** Sets a Title's monitoring: a Movie's on or off, a Series' mode. A failure is a Toast. */
function useSetMonitoring(title: TitleDetail) {
  const movie = useSetMovieMonitored(title.id)
  const series = useSetSeriesMonitor(title.id)
  const report = useReport()
  return {
    pending: movie.isPending || series.isPending,
    set: (v: Mode) => void report(title.kind === 'movie' ? movie.mutateAsync(v === 'monitored') : series.mutateAsync(v as SeriesMonitor), { failed: 'Could not change monitoring' }),
  }
}

/** The monitoring control of the meta line: its state in words as a quiet dropdown, whose menu lists the choices as radio items, the current one checked. */
export function MonitoringMenu({ title }: { title: TitleDetail }) {
  const { pending, set } = useSetMonitoring(title)
  const options = choices(title)
  const value = modeOf(title)
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <Menu.Container position="bottom-start">
      <Menu.Button variant="tertiary" size="tiny" showChevron disabled={pending}>
        {current.label}
      </Menu.Button>
      <Menu>
        {options.map((o) => (
          <MenuItem key={o.value} role="radio" checked={o.value === value} onSelect={() => set(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )
}

/** The Monitoring… item's Modal: the same choices as radios; choosing one applies it and closes. */
function MonitoringDialog({ title, onClose }: { title: TitleDetail; onClose: () => void }) {
  const { pending, set } = useSetMonitoring(title)
  return (
    <Modal open size="small" title="Monitoring" onClose={onClose}>
      <Radio.Group
        label="Monitoring"
        value={modeOf(title)}
        disabled={pending}
        onChange={(v) => {
          set(v as Mode)
          onClose()
        }}
      >
        {choices(title).map((o) => (
          <Radio.GroupItem key={o.value} value={o.value}>
            {o.label}
          </Radio.GroupItem>
        ))}
      </Radio.Group>
    </Modal>
  )
}

/**
 * The header's right side: ONE primary Search button (Search Wanted, or for a Movie with one Wanted Version Search and its Slot)
 * whose dropdown has Manual search… and the broader search over every Version, and the Title "…" menu with everything rarer.
 */
export function TitleActions({
  title,
  profiles,
  profileName,
  onManualSearch,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch: (target: ManualSearchTarget) => void
}) {
  const [panel, setPanel] = useState<'monitoring' | 'add' | 'move' | 'remove' | null>(null)
  const openCleanup = useOpenCleanup()
  const openPlace = useOpenPlace()
  const report = useReport()
  const search = useSearchWanted(title)
  const refresh = useRefreshTitle(title.id)
  const freeze = useSetFrozen(title.id)
  const frozen = title.metadata_frozen
  const unmonitored = title.kind === 'movie' ? !title.monitored : title.series_monitor === 'none'
  const wanted = title.versions.filter((v) => v.state === 'wanted')
  const label = title.kind === 'movie' && wanted.length === 1 ? `Search ${slotLabel[wanted[0].slot]}` : 'Search Wanted'
  const why = unmonitored ? NOT_MONITORED_SEARCH : wanted.length === 0 ? 'Nothing in this Title is Wanted' : undefined
  const manual = (v: TitleDetail['versions'][number]) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
  const searchItems = [
    ...title.versions.map((v) => ({
      title: title.versions.length === 1 ? 'Manual search…' : `Manual search: ${slotLabel[v.slot]}…`,
      description: 'Pick a Release yourself',
      menuItemProps: { onClick: () => manual(v) },
    })),
    {
      title: 'Search all Versions',
      description: 'Also look for Upgrades',
      disabled: unmonitored || title.versions.length === 0,
      menuItemProps: { onClick: () => search.run(title.versions.map((v) => v.id)) },
    },
  ]
  const free = title.versions.length < 2
  const monitoring = choices(title).find((o) => o.value === modeOf(title))
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <SplitButton
          buttonProps={{ size: 'medium', variant: 'default', disabled: !!why || search.mutation.isPending, title: why, onClick: () => search.run() }}
          menuButtonLabel="More search options"
          menuAlignment="bottom-end"
          menuItems={searchItems}
        >
          {label}
        </SplitButton>
        <DotsMenu size="medium" aria-label="Title actions">
          <MenuItem
            prefix={<Eye aria-hidden className="size-4" />}
            suffix={<span className="label-12 text-gray-900">{monitoring?.label.replace(/^Monitoring /, '')}</span>}
            onSelect={() => setPanel('monitoring')}
          >
            Monitoring…
          </MenuItem>
          <MenuItem prefix={<Plus aria-hidden className="size-4" />} disabled={!free} description={free ? undefined : 'Every Slot has a Version'} onSelect={() => setPanel('add')}>
            Add Version…
          </MenuItem>
          <MenuDivider />
          <MenuItem
            prefix={<RefreshCw aria-hidden className="size-4" />}
            disabled={frozen || refresh.isPending}
            description={frozen ? 'Metadata is frozen: unfreeze it to refresh' : undefined}
            onSelect={() => void report(refresh.mutateAsync(), { done: 'Refreshing metadata… The Title updates when it is done.', failed: 'Could not refresh the metadata' })}
          >
            Refresh metadata
          </MenuItem>
          <MenuItem
            prefix={<Snowflake aria-hidden className="size-4" />}
            disabled={freeze.isPending}
            onSelect={() => void report(freeze.mutateAsync(!frozen), { failed: 'Could not change freezing' })}
          >
            {frozen ? 'Unfreeze metadata' : 'Freeze metadata'}
          </MenuItem>
          <MenuSection title="Open in">{externalIdItems(title)}</MenuSection>
          <MenuItem prefix={<ScrollText aria-hidden className="size-4" />} onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))}>
            Show in Log
          </MenuItem>
          <MenuDivider />
          <MenuItem prefix={<FolderInput aria-hidden className="size-4" />} onSelect={() => setPanel('move')}>
            Move…
          </MenuItem>
          <MenuItem prefix={<BrushCleaning aria-hidden className="size-4" />} onSelect={() => openCleanup([title.id])}>
            Clean up…
          </MenuItem>
          <MenuDivider />
          <MenuItem type="error" prefix={<Trash2 aria-hidden className="size-4" />} onSelect={() => setPanel('remove')}>
            Remove Title…
          </MenuItem>
        </DotsMenu>
      </div>
      {panel === 'monitoring' && <MonitoringDialog title={title} onClose={() => setPanel(null)} />}
      {panel === 'add' && <AddVersion title={title} profiles={profiles} onClose={() => setPanel(null)} />}
      {panel === 'move' && <MoveTitle title={title} onClose={() => setPanel(null)} />}
      {panel === 'remove' && <RemoveTitle titleId={title.id} onCancel={() => setPanel(null)} />}
    </>
  )
}
