// The Title actions row under a Title's description: searches, metadata, monitoring and a "…" menu.
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { ApiError, type TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen, useSetMovieMonitored } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { termText } from '../filter/query'
import { Button, ErrorText } from '../forms'
import { Menu, MenuItem } from '../menu'
import { placePath, useOpenPlace } from '../place'
import { RemoveTitle } from './ManageVersion'
import { MoveTitle } from './MoveTitle'
import type { ManualSearchTarget } from './TitleDetail'
import { useFade } from './useFade'
import { ManualSearch, SearchNow, useSearchWanted } from './VersionSearch'

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/**
 * One row of compact buttons for the whole Title. The rarer and dangerous ones
 * (Move, Clean up this Title, Show in the Log, Remove Title) sit in the "…" menu at its end;
 * what they open (the Root folder picker, the removal confirmation) shows
 * right under the row.
 */
export function TitleActions({
  title,
  profileName,
  onManualSearch,
}: {
  title: TitleDetail
  profileName: (key: string) => string
  onManualSearch: (target: ManualSearchTarget) => void
}) {
  const [panel, setPanel] = useState<'move' | 'remove' | null>(null)
  const openCleanup = useOpenCleanup()
  const openPlace = useOpenPlace()
  const search = useSearchWanted(title)
  useFade(search.mutation.isSuccess ? search.mutation.submittedAt : null, search.mutation.reset)
  const refresh = useRefreshTitle(title.id)
  const freeze = useSetFrozen(title.id)
  const frozen = title.metadata_frozen
  return (
    <div className="mt-4">
      <div role="group" aria-label="Title actions" className="flex flex-wrap items-center gap-2">
        <SearchNow search={search} />
        <ManualSearch title={title} profileName={profileName} onManualSearch={onManualSearch} />
        <Button
          variant="secondary"
          className="h-7"
          disabled={frozen || refresh.isPending}
          title={frozen ? 'Metadata is frozen: unfreeze it to refresh' : undefined}
          onClick={() => refresh.mutate()}
        >
          Refresh metadata
        </Button>
        <Button variant="secondary" className="h-7" disabled={freeze.isPending} onClick={() => freeze.mutate(!frozen)}>
          {frozen ? 'Unfreeze metadata' : 'Freeze metadata'}
        </Button>
        {title.kind === 'movie' && <MovieMonitored title={title} />}
        <Menu
          label="More Title actions"
          className="ml-auto"
          buttonClassName="size-7 rounded-md border border-gray-alpha-400 bg-background-100"
          trigger={<MoreHorizontal className="size-4" aria-hidden />}
        >
          <MenuItem onSelect={() => setPanel('move')}>Move</MenuItem>
          <MenuItem onSelect={() => openCleanup([title.id])}>Clean up this Title</MenuItem>
          <MenuItem onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], negated: false })))}>Show in the Log</MenuItem>
          <MenuItem onSelect={() => setPanel('remove')}>Remove Title</MenuItem>
        </Menu>
      </div>
      {search.mutation.isSuccess && <p className="mt-1 text-[12px] text-gray-900">Searching… The Log shows what it grabs.</p>}
      {search.mutation.isError && <ErrorText>{message(search.mutation.error, 'Could not start the search.')}</ErrorText>}
      {refresh.isSuccess && <p className="mt-1 text-[12px] text-gray-900">Refreshing metadata… The Title updates when it is done.</p>}
      {refresh.isError && <ErrorText>{message(refresh.error, 'Could not refresh the metadata.')}</ErrorText>}
      {freeze.isError && <ErrorText>{message(freeze.error, 'Could not change freezing.')}</ErrorText>}
      {panel === 'move' && <MoveTitle title={title} onClose={() => setPanel(null)} />}
      {panel === 'remove' && <RemoveTitle titleId={title.id} onCancel={() => setPanel(null)} />}
    </div>
  )
}

/**
 * A Movie's Monitored switch: off, the Movie is never searched, grabbed or
 * upgraded automatically, which a line under the row then says. A Series has
 * its monitoring mode above the episode grid instead.
 */
function MovieMonitored({ title }: { title: TitleDetail }) {
  const set = useSetMovieMonitored(title.id)
  const hint = `title-${title.id}-monitored-hint`
  return (
    <>
      <label className="flex h-7 items-center gap-2 px-1 text-[13px]">
        <input type="checkbox" checked={title.monitored} disabled={set.isPending} aria-describedby={hint} onChange={(e) => set.mutate(e.target.checked)} />
        Monitored
      </label>
      <p id={hint} className={title.monitored ? 'sr-only' : 'order-last w-full text-[12px] text-gray-900'}>
        {title.monitored ? 'Kestrel searches for this Movie and upgrades its files.' : 'Kestrel leaves this Movie as it is: no searches, Grabs or Upgrades.'}
      </p>
      {set.isError && (
        <div className="order-last w-full">
          <ErrorText>{message(set.error, 'Could not change monitoring.')}</ErrorText>
        </div>
      )}
    </>
  )
}
