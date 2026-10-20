// Search now and Manual search for a Title's Versions, in the Title actions row.
import { useMutation } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useSearchNow } from '../api/grabs'
import type { TitleDetail } from '../api/queries'
import { Button } from '../forms'
import { Menu, MenuItem } from '../menu'
import { slotLabel } from './bits'
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

export function SearchNow({ search }: { search: ReturnType<typeof useSearchWanted> }) {
  const none = search.wanted.length === 0
  return (
    <Button
      variant="secondary"
      className="h-7"
      disabled={none || search.mutation.isPending}
      title={none ? 'Nothing in this Title is Wanted' : undefined}
      onClick={search.run}
    >
      Search now
    </Button>
  )
}

/** Manual search lists every Release for a Version to pick from; with two Versions it asks which. */
export function ManualSearch({
  title,
  profileName,
  onManualSearch,
}: {
  title: TitleDetail
  profileName: (key: string) => string
  onManualSearch: (target: ManualSearchTarget) => void
}) {
  const open = (v: TitleDetail['versions'][number]) => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
  if (title.versions.length === 0) return null
  if (title.versions.length === 1) {
    return (
      <Button variant="secondary" className="h-7" onClick={() => open(title.versions[0])}>
        Manual search
      </Button>
    )
  }
  return (
    <Menu
      label="Manual search"
      buttonClassName="h-7 gap-1 rounded-md border border-gray-alpha-400 bg-background-100 px-3 text-[13px] font-medium text-gray-1000 hover:bg-gray-alpha-100"
      trigger={
        <>
          Manual search
          <ChevronDown size={14} aria-hidden />
        </>
      }
    >
      {title.versions.map((v) => (
        <MenuItem key={v.id} onSelect={() => open(v)}>
          {slotLabel[v.slot]} · {profileName(v.profile)}
        </MenuItem>
      ))}
    </Menu>
  )
}
