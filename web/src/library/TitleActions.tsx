// The Title actions row under a Title's description: searches, metadata, monitoring and a "…" menu.
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { ApiError, type TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen, useSetMovieMonitored } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { termText } from '../filter/query'
import { Button, Checkbox, Menu, Note } from '@hyprsh/design'
import { placePath, useOpenPlace } from '../place'
import { RemoveTitle } from './ManageVersion'
import { MoveTitle } from './MoveTitle'
import type { ManualSearchTarget } from './TitleDetail'
import { useFade } from './useFade'
import { ManualSearch, SearchNow, useSearchWanted } from './VersionSearch'

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** An error under the actions row. */
const Problem = ({ children }: { children: string }) => (
  <div className="mt-2">
    <Note variant="error" size="small">
      {children}
    </Note>
  </div>
)

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
          size="small"
          disabled={frozen || refresh.isPending}
          title={frozen ? 'Metadata is frozen: unfreeze it to refresh' : undefined}
          onClick={() => refresh.mutate()}
        >
          Refresh metadata
        </Button>
        <Button variant="secondary" size="small" disabled={freeze.isPending} onClick={() => freeze.mutate(!frozen)}>
          {frozen ? 'Unfreeze metadata' : 'Freeze metadata'}
        </Button>
        {title.kind === 'movie' && <MovieMonitored title={title} />}
        <Menu.Container position="bottom-end" className="ml-auto">
          <Menu.Button svgOnly variant="tertiary" size="small" aria-label="More Title actions">
            <MoreHorizontal />
          </Menu.Button>
          <Menu>
            <Menu.Item onSelect={() => setPanel('move')}>Move</Menu.Item>
            <Menu.Item onSelect={() => openCleanup([title.id])}>Clean up this Title</Menu.Item>
            <Menu.Item onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], negated: false })))}>Show in the Log</Menu.Item>
            <Menu.Divider />
            <Menu.Item type="error" onSelect={() => setPanel('remove')}>
              Remove Title
            </Menu.Item>
          </Menu>
        </Menu.Container>
      </div>
      {search.mutation.isSuccess && <p className="label-12 mt-1 text-gray-900">Searching… The Log shows what it grabs.</p>}
      {search.mutation.isError && <Problem>{message(search.mutation.error, 'Could not start the search.')}</Problem>}
      {refresh.isSuccess && <p className="label-12 mt-1 text-gray-900">Refreshing metadata… The Title updates when it is done.</p>}
      {refresh.isError && <Problem>{message(refresh.error, 'Could not refresh the metadata.')}</Problem>}
      {freeze.isError && <Problem>{message(freeze.error, 'Could not change freezing.')}</Problem>}
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
      <Checkbox checked={title.monitored} disabled={set.isPending} aria-describedby={hint} onChange={(e) => set.mutate(e.target.checked)}>
        Monitored
      </Checkbox>
      <p id={hint} className={title.monitored ? 'sr-only' : 'label-12 order-last w-full text-gray-900'}>
        {title.monitored ? 'Kestrel searches for this Movie and upgrades its files.' : 'Kestrel leaves this Movie as it is: no searches, Grabs or Upgrades.'}
      </p>
      {set.isError && (
        <div className="order-last w-full">
          <Problem>{message(set.error, 'Could not change monitoring.')}</Problem>
        </div>
      )}
    </>
  )
}
