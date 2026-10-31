// The Title actions row under a Title's header: searches, monitoring and a "…" menu.
import { useState } from 'react'
import { ApiError, type SeriesMonitor, type TitleDetail } from '../api/queries'
import { useRefreshTitle, useSetFrozen, useSetMovieMonitored, useSetSeriesMonitor } from '../api/titleActions'
import { useOpenCleanup } from '../cleanup/launch'
import { Check, CircleMinus } from 'lucide-react'
import { DotsMenu, Menu, MenuDivider, MenuItem, Note, termText } from '@hyprsh/design'
import { placePath, useOpenPlace } from '../place'
import { RemoveTitle } from './ManageVersion'
import { MoveTitle } from './MoveTitle'
import type { ManualSearchTarget } from './TitleDetail'
import { useFade } from './useFade'
import { ManualSearch, SearchNow, useSearchWanted } from './VersionSearch'

const NOT_MONITORED_SEARCH = 'Not monitored: turn monitoring on to search'

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
        <SearchNow search={search} unmonitored={title.kind === 'movie' ? !title.monitored : title.series_monitor === 'none'} />
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

/** The monitoring control of the row: a secondary button showing the whole state, whose menu lists the options with a check on the current one. */
function MonitoringMenu<V extends string>({ value, options, disabled, onChange }: { value: V; options: { value: V; label: string }[]; disabled: boolean; onChange: (v: V) => void }) {
  const current = options.find((o) => o.value === value) ?? options[0]
  const off = current.label === NOT_MONITORED
  return (
    <Menu.Container position="bottom-start">
      <Menu.Button variant="secondary" size="small" showChevron disabled={disabled} aria-label={`Monitoring: ${current.label}`} prefix={off ? <CircleMinus aria-hidden /> : undefined}>
        {current.label}
      </Menu.Button>
      <Menu>
        {options.map((o) => (
          <MenuItem key={o.value} prefix={o.value === value ? <Check aria-hidden /> : <span aria-hidden className="size-4" />} onSelect={() => onChange(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )
}

const NOT_MONITORED = 'Not monitored'

/** The monitoring control of a Movie: Not monitored, it is never searched, grabbed or upgraded automatically, which a line under the row says. */
function MovieMonitoring({ title }: { title: TitleDetail }) {
  const set = useSetMovieMonitored(title.id)
  const hint = `title-${title.id}-monitored-hint`
  return (
    <>
      <MonitoringMenu
        value={title.monitored ? 'monitored' : 'unmonitored'}
        disabled={set.isPending}
        onChange={(v) => set.mutate(v === 'monitored')}
        options={[
          { value: 'monitored', label: 'Monitored' },
          { value: 'unmonitored', label: NOT_MONITORED },
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

/** The monitoring control of a Series: which episodes it wants. */
function SeriesMonitoring({ title }: { title: TitleDetail }) {
  const set = useSetSeriesMonitor(title.id)
  const mode = title.series_monitor ?? 'all'
  return (
    <>
      <MonitoringMenu<SeriesMonitor>
        value={mode}
        disabled={set.isPending}
        onChange={(v) => set.mutate(v)}
        options={[
          { value: 'all', label: 'Monitored: all episodes' },
          { value: 'future', label: 'Monitored: future episodes' },
          { value: 'none', label: NOT_MONITORED },
        ]}
      />
      {mode === 'none' && <p className="label-12 order-last w-full text-gray-900">{NOT_MONITORED_SEARCH}</p>}
      {set.isError && (
        <div className="order-last w-full">
          <Problem>{message(set.error, 'Could not change monitoring.')}</Problem>
        </div>
      )}
    </>
  )
}
