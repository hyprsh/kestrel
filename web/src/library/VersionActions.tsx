// What a Version card can do, shared by a Series' column heads and a Movie's cards: its main action as a Button (Search Now, Open in
// Activity, Search for Upgrade) and the ⋯ menu "<Slot> Actions" (Manual Search…, Switch Profile…, Show in Log, Cancel Download while it
// downloads, Remove Version…; a Movie's card adds File Details… and Delete Files…), with the Profile picker and the removal's
// confirmation the menu opens.
import { Button, DotsMenu, MenuDivider, MenuItem, termText } from '@hyprsh/design'
import { ScrollText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import { placePath, useOpenPlace } from '../place'
import { useReport } from '../toasts'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, type SlotDownloads } from './TitleDownloads'
import { useSearchVersion } from './VersionSearch'

export type Version = TitleDetail['versions'][number]

/** What a Version card needs from its Title page. */
export type VersionProps = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

/** Whether the Title is not monitored: nothing is searched for it. */
const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

type MainAction = {
  label: string
  onSelect: () => void
  disabled: boolean
  reason?: string
  /** Open in Activity and Search Now are the card's primary button; an Upgrade search is a quieter one. */ variant: 'default' | 'secondary'
}

/**
 * A Version's main action: Open in Activity while a Movie downloads, or a Series with nothing else to search; Search Now while
 * something is Wanted; else Search for Upgrade where there is a file, and Search Now where there is not (disabled while the Title is
 * not monitored).
 */
function useMainAction(title: TitleDetail, v: Version, downloads: SlotDownloads | null): MainAction {
  const openPlace = useOpenPlace()
  const search = useSearchVersion(title, v.id)
  const off = unmonitored(title)
  const c = v.coverage
  const movie = title.kind === 'movie'
  const left = c ? c.wanted - (downloads ? c.downloading : 0) > 0 : v.state === 'wanted'
  const activity = downloads && (movie || !left)
  const upgrade = !activity && !left && (movie ? !!v.file || v.state === 'filled' : !!c && c.filled > 0)
  if (activity) return { label: 'Open in Activity', onSelect: () => openPlace(placePath('activity')), disabled: false, variant: 'default' }
  return {
    label: upgrade ? 'Search for Upgrade' : 'Search Now',
    onSelect: search.run,
    disabled: off || search.pending,
    reason: off ? 'Not monitored: turn monitoring on to search' : undefined,
    variant: upgrade ? 'secondary' : 'default',
  }
}

/**
 * A Version card's actions: the main Button (full width with the menu beside it on a phone) and the ⋯ menu. `onFileDetails` and
 * `onDeleteFiles` are a Movie's: they add File Details… and Delete Files… to the menu (the card shows what they open).
 */
export function VersionActions({
  title,
  version: v,
  profiles,
  profileName,
  onManualSearch,
  downloads,
  phone,
  onFileDetails,
  onDeleteFiles,
  trailing,
}: VersionProps & {
  version: Version
  downloads: SlotDownloads | null
  phone: boolean
  onFileDetails?: () => void
  onDeleteFiles?: () => void
  /** What sits between the Button and the menu on a wide screen: a Movie's size. */
  trailing?: ReactNode
}) {
  const sw = useSwitchProfile(v.id)
  const report = useReport()
  const rm = useRemoveVersion(v.id)
  const cancel = useCancelDownloads()
  const openPlace = useOpenPlace()
  const action = useMainAction(title, v, downloads)
  const [mode, setMode] = useState<'switch' | 'remove' | null>(null)
  const name = useSlotNames().name(v.slot)
  return (
    <>
      <span className={`flex items-center gap-1 ${phone ? 'w-full' : 'flex-wrap'}`}>
        <Button
          variant={action.variant}
          size={phone ? 'medium' : 'small'}
          width={phone ? '100%' : undefined}
          // A narrow column wraps a long label ("Open in Activity") onto a second line rather than cutting it.
          className={phone ? undefined : 'h-auto min-h-8 max-w-full whitespace-normal py-1 text-left'}
          disabled={action.disabled}
          title={action.disabled ? action.reason : undefined}
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
        {!phone && <span className="flex-1" />}
        {trailing}
        <DotsMenu aria-label={`${name} Actions`} size={phone ? 'medium' : 'small'} width={260}>
          <MenuItem onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>Manual Search…</MenuItem>
          {onFileDetails && (
            <MenuItem disabled={!v.file} description={v.file ? undefined : 'No file yet'} onSelect={onFileDetails}>
              File Details…
            </MenuItem>
          )}
          <MenuItem suffix={<span className="label-12-mono text-gray-900">{profileName(v.profile)}</span>} onSelect={() => setMode('switch')}>
            Switch Profile…
          </MenuItem>
          <MenuItem prefix={<ScrollText aria-hidden className="size-4" />} onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))}>
            Show in Log
          </MenuItem>
          {downloads && (
            <>
              <MenuDivider />
              <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, false)}>
                {downloads.items.length === 1 ? 'Cancel Download' : 'Cancel Downloads'}
              </MenuItem>
              <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, true)}>
                Cancel and Blocklist
              </MenuItem>
            </>
          )}
          <MenuDivider />
          {onDeleteFiles && (
            <MenuItem type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={onDeleteFiles}>
              Delete Files…
            </MenuItem>
          )}
          <MenuItem type="error" onSelect={() => setMode('remove')}>
            Remove Version…
          </MenuItem>
        </DotsMenu>
      </span>
      {mode === 'switch' && (
        <ProfilePicker
          profiles={profiles}
          initial={v.profile}
          label="Switch Profile"
          busy={sw.isPending}
          error={sw.error?.message}
          onCancel={() => setMode(null)}
          onPick={(p) => void report(sw.mutateAsync(p), { done: 'Profile switched' }).then((r) => r !== undefined && setMode(null))}
        />
      )}
      {mode === 'remove' && (
        <RemoveConfirm
          what="Version"
          onCancel={() => setMode(null)}
          onConfirm={(d) => {
            setMode(null)
            void report(rm.mutateAsync(d), { done: 'Version removed', failed: 'Could not remove the Version' })
          }}
        />
      )}
    </>
  )
}
