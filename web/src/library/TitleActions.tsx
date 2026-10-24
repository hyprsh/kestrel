// The Title actions row under a Title's header: searches, monitoring and a "…" menu.
import { useState } from 'react'
import { ApiError, type SeriesMonitor, type TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen, useSetMovieMonitored, useSetSeriesMonitor } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { DotsMenu, FilterMenu, MenuDivider, MenuItem, Note, termText } from '@hyprsh/design'
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
 * One row of compact controls for the whole Title: the searches and monitoring. The rarer and dangerous ones
 * (Refresh and Freeze metadata, Move, Clean up this Title, Show in the Log, Remove Title) sit in the "…" menu at its end;
 * what they open (the Root folder picker, the removal confirmation) shows
 * right under the row.
 */
export function TitleActions({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }) {
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
        {title.kind === 'movie' ? <MovieMonitoring title={title} /> : <SeriesMonitoring title={title} />}
        <DotsMenu className="ml-auto" aria-label="More Title actions">
          <MenuItem disabled={frozen || refresh.isPending} description={frozen ? 'Metadata is frozen: unfreeze it to refresh' : undefined} onSelect={() => refresh.mutate()}>
            Refresh metadata
          </MenuItem>
          <MenuItem disabled={freeze.isPending} onSelect={() => freeze.mutate(!frozen)}>
            {frozen ? 'Unfreeze metadata' : 'Freeze metadata'}
          </MenuItem>
          <MenuDivider />
          <MenuItem onSelect={() => setPanel('move')}>Move</MenuItem>
          <MenuItem onSelect={() => openCleanup([title.id])}>Clean up this Title</MenuItem>
          <MenuItem onSelect={() => openPlace(placePath('log', termText({ name: 'title', values: [title.title], excluded: false })))}>Show in the Log</MenuItem>
          <MenuDivider />
          <MenuItem type="error" onSelect={() => setPanel('remove')}>
            Remove Title
          </MenuItem>
        </DotsMenu>
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

/** The monitoring dropdown of a Movie: Not monitored, it is never searched, grabbed or upgraded automatically, which a line under the row says. */
function MovieMonitoring({ title }: { title: TitleDetail }) {
  const set = useSetMovieMonitored(title.id)
  const hint = `title-${title.id}-monitored-hint`
  return (
    <>
      <FilterMenu
        single
        label="Monitor"
        size="small"
        defaultOption="monitored"
        value={title.monitored ? 'monitored' : 'unmonitored'}
        disabled={set.isPending}
        onChange={(v: string) => set.mutate(v === 'monitored')}
        items={[
          { value: 'monitored', label: 'Monitored' },
          { value: 'unmonitored', label: 'Not monitored' },
        ]}
      />
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

/** The monitoring dropdown of a Series: which episodes it wants. */
function SeriesMonitoring({ title }: { title: TitleDetail }) {
  const set = useSetSeriesMonitor(title.id)
  return (
    <>
      <FilterMenu
        single
        label="Monitor"
        size="small"
        defaultOption="all"
        value={title.series_monitor ?? 'all'}
        disabled={set.isPending}
        onChange={(v: string) => set.mutate(v as SeriesMonitor)}
        items={[
          { value: 'all', label: 'All episodes' },
          { value: 'future', label: 'Future episodes only' },
          { value: 'none', label: 'None' },
        ]}
      />
      {set.isError && (
        <div className="order-last w-full">
          <Problem>{message(set.error, 'Could not change monitoring.')}</Problem>
        </div>
      )}
    </>
  )
}
