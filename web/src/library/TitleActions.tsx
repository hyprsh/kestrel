// The Title page's header controls: the Monitored button (MonitorButton.tsx), one primary Search button with its dropdown
// (Monitor instead on an unmonitored Movie, which moves Search into the menu), and the Title "…" menu. What the rarer
// items open (the Root folder picker, the removal confirmation, Add Version) shows in a Modal.
import { useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { BrushCleaning, Database, ExternalLink, Folder, FolderInput, Plus, RefreshCw, ScrollText, Snowflake, Trash2 } from 'lucide-react'
import { DotsMenu, Menu, MenuDivider, MenuItem, SplitButton, termText } from '@hyprsh/design'
import { usePhone } from '../responsive'
import { placePath, useOpenPlace } from '../place'
import { useReport } from '../toasts'
import { externalIdItems } from './ExternalIds'
import { AddVersion, RemoveTitle } from './ManageVersion'
import { MonitorButton, isMonitored } from './MonitorButton'
import { MoveTitle } from './MoveTitle'
import { useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useSearchWanted } from './VersionSearch'

const NOT_MONITORED_SEARCH = 'Not monitored: turn monitoring on to search'

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
  const [panel, setPanel] = useState<'add' | 'move' | 'remove' | null>(null)
  const phone = usePhone()
  const openCleanup = useOpenCleanup()
  const openPlace = useOpenPlace()
  const report = useReport()
  const slots = useSlotNames()
  const search = useSearchWanted(title)
  const refresh = useRefreshTitle(title.id)
  const freeze = useSetFrozen(title.id)
  const frozen = title.metadata_frozen
  const unmonitored = !isMonitored(title)
  const wanted = title.versions.filter((v) => v.state === 'wanted')
  const label = title.kind === 'movie' && wanted.length === 1 ? `Search ${slots.name(wanted[0].slot)}` : 'Search Wanted'
  const why = unmonitored ? NOT_MONITORED_SEARCH : wanted.length === 0 ? 'Nothing in this Title is Wanted' : undefined
  const manual = (v: TitleDetail['versions'][number]) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
  const searchItems = [
    ...title.versions.map((v) => ({
      title: title.versions.length === 1 ? 'Manual search…' : `Manual search: ${slots.name(v.slot)}…`,
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
  const free = title.versions.length < slots.list.length
  const links = externalIdItems(title)
  const size = phone ? 'large' : 'medium'
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        <div className="max-sm:min-w-36 max-sm:flex-1 max-sm:[&>*]:w-full">
          <MonitorButton title={title} size={size} short={phone} />
        </div>
        <div className="max-sm:min-w-36 max-sm:flex-1 max-sm:[&>*]:w-full">
          <SplitButton
            buttonProps={{ size, variant: 'default', disabled: !!why || search.mutation.isPending, title: why, onClick: () => search.run() }}
            menuButtonLabel="More search options"
            menuAlignment="bottom-end"
            menuItems={searchItems}
          >
            {label}
          </SplitButton>
        </div>
        <DotsMenu size="medium" aria-label="Title actions">
          <MenuItem prefix={<Plus aria-hidden className="size-4" />} disabled={!free} description={free ? undefined : 'Every Slot has a Version'} onSelect={() => setPanel('add')}>
            Add Version…
          </MenuItem>
          <MenuDivider />
          <Menu.Sub>
            <Menu.SubTrigger prefix={<Database aria-hidden className="size-4" />}>Metadata</Menu.SubTrigger>
            <Menu>
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
            </Menu>
          </Menu.Sub>
          {links.length > 0 && (
            <Menu.Sub>
              <Menu.SubTrigger prefix={<ExternalLink aria-hidden className="size-4" />}>Open in</Menu.SubTrigger>
              <Menu>{links}</Menu>
            </Menu.Sub>
          )}
          <MenuItem prefix={<ScrollText aria-hidden className="size-4" />} onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))}>
            Show in Log
          </MenuItem>
          <MenuDivider />
          <Menu.Sub>
            <Menu.SubTrigger prefix={<Folder aria-hidden className="size-4" />}>Files</Menu.SubTrigger>
            <Menu>
              <MenuItem prefix={<FolderInput aria-hidden className="size-4" />} onSelect={() => setPanel('move')}>
                Move…
              </MenuItem>
              <MenuItem prefix={<BrushCleaning aria-hidden className="size-4" />} onSelect={() => openCleanup([title.id])}>
                Clean up…
              </MenuItem>
            </Menu>
          </Menu.Sub>
          <MenuDivider />
          <MenuItem type="error" prefix={<Trash2 aria-hidden className="size-4" />} onSelect={() => setPanel('remove')}>
            Remove Title…
          </MenuItem>
        </DotsMenu>
      </div>
      {panel === 'add' && <AddVersion title={title} profiles={profiles} onClose={() => setPanel(null)} />}
      {panel === 'move' && <MoveTitle title={title} onClose={() => setPanel(null)} />}
      {panel === 'remove' && <RemoveTitle titleId={title.id} onCancel={() => setPanel(null)} />}
    </>
  )
}
