// Search now and Manual search for a Title's Versions, in the Title actions row.
import { useMutation } from '@tanstack/react-query'
import { useSearchNow } from '../api/grabs'
import type { TitleDetail } from '../api/queries'
import { Button, Menu } from '@hyprsh/design'
import { slotProfile } from './slotProfile'
import type { ManualSearchTarget } from './TitleDetail'

/**
 * Search now runs the automatic search at once for every Version of the Title
 * that is Wanted (a Series in full, once per season). It only has something to
 * do while one is Wanted.
 */
export function useSearchWanted(title: TitleDetail) {
  const one = useSearchNow()
  const wanted = title.versions.filter((v) => v.state === 'wanted').map((v) => v.id)
  const all = useMutation({ mutationFn: (ids: number[]) => Promise.all(ids.map((versionId) => one.mutateAsync({ versionId }))) })
  return { mutation: all, wanted, run: () => all.mutate(wanted) }
}

export function SearchNow({ search, unmonitored }: { search: ReturnType<typeof useSearchWanted>; unmonitored: boolean }) {
  const none = search.wanted.length === 0
  const why = unmonitored ? 'Not monitored: turn monitoring on to search' : none ? 'Nothing in this Title is Wanted' : undefined
  return (
    <Button variant="secondary" size="small" disabled={unmonitored || none || search.mutation.isPending} title={why} onClick={search.run}>
      Search now
    </Button>
  )
}

/** Manual search lists every Release for a Version to pick from; with two Versions it asks which. */
export function ManualSearch({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }) {
  const open = (v: TitleDetail['versions'][number]) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
  if (title.versions.length === 0) return null
  if (title.versions.length === 1) {
    return (
      <Button variant="secondary" size="small" onClick={() => open(title.versions[0])}>
        Manual search
      </Button>
    )
  }
  return (
    <Menu.Container position="bottom-end">
      <Menu.Button variant="secondary" size="small" aria-label="Manual search" showChevron>
        Manual search
      </Menu.Button>
      <Menu>
        {title.versions.map((v) => (
          <Menu.Item key={v.id} onSelect={() => open(v)}>
            {slotProfile(v.slot, profileName(v.profile))}
          </Menu.Item>
        ))}
      </Menu>
    </Menu.Container>
  )
}
