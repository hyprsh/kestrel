import { CornerDownLeft } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError, useCreateTitle, useLookupDetail, useProfiles, useSeriesOverview, useSettings, type LookupResult, type Profile } from '../api/queries'
import { Button, ErrorText, Select } from '../forms'
import { slotKeys, slotLabel, type SlotKey } from '../library/bits'
import { Ratings } from '../library/Ratings'
import { Kbd } from '../ui'
import { LookupSummary } from './LookupSummary'
import { allEpisodes, seasonBody, SeasonPresets, type SeasonChoice } from './SeasonPresets'
import { SeriesOverviewLine } from './SeriesOverview'

/** The Profile a Slot gets when ticked without a suggestion: its default, else the first enabled Primary-Language one (Any comes after HD in the list). */
function fallbackProfile(profiles: Profile[], slot: SlotKey, kind: 'movie' | 'series'): string | undefined {
  const of = profiles.filter((p) => p.slot === slot && p.enabled)
  return (of.find((p) => (kind === 'series' ? p.default_series : p.default_movies)) ?? of.find((p) => p.language_rule === 'primary') ?? of[0])?.key
}

/**
 * The add panel: every Slot with a default is preselected, with the reason
 * ("HD (default)"). One key (Enter) adds; Slots and Profiles
 * can be changed first.
 */
export function AddConfirm({ result, onBack, onAdded }: { result: LookupResult; onBack: () => void; onAdded: (titleId: number) => void }) {
  const suggestion = useLookupDetail(result.kind, result.tmdb_id)
  const overview = useSeriesOverview(result.tmdb_id, result.kind === 'series')
  const series = overview.data ?? null
  const profiles = useProfiles()
  const settings = useSettings()
  const create = useCreateTitle()
  const panel = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<Partial<Record<SlotKey, string>>>({})
  const [seeded, setSeeded] = useState(false)
  const [root, setRoot] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<SeasonChoice>(allEpisodes)

  useEffect(() => panel.current?.focus(), [])

  // Seed the choices once from the server's suggestion; after that the user's edits stand.
  useEffect(() => {
    if (seeded || !suggestion.data) return
    setPicked(Object.fromEntries(suggestion.data.slots.map((s) => [s.slot, s.profile])))
    setSeeded(true)
  }, [seeded, suggestion.data])

  const all = profiles.data ?? []
  const folders = settings.data?.root_folders
  const roots = (result.kind === 'series' ? folders?.series : folders?.movies) ?? []
  // The server files a new Title in the kind's first root folder when none is named.
  const defaultRoot = roots[0]
  const chosen = slotKeys.filter((k) => picked[k])
  const ready = seeded && chosen.length > 0 && !create.isPending

  const add = () => {
    if (!ready) return
    create.mutate(
      {
        kind: result.kind,
        tmdb_id: result.tmdb_id,
        versions: chosen.map((slot) => ({ slot, profile: picked[slot]! })),
        ...(result.kind === 'series' ? seasonBody(seasons, series) : {}),
        ...(root ? { root_folder: root } : {}),
      },
      { onSuccess: (title) => onAdded(title.id) },
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    // A focused button or the Profile pickers keep Enter for themselves, unless it is Cmd/Ctrl+Enter.
    if (!(e.metaKey || e.ctrlKey) && e.target instanceof Element && e.target.closest('button, select')) return
    e.preventDefault()
    add()
  }

  const reasons = (suggestion.data?.slots ?? []).map(
    (s) => `${slotLabel[s.slot]} · ${s.label} (default)`,
  )

  return (
    <div ref={panel} tabIndex={-1} onKeyDown={onKeyDown} className="flex min-h-0 flex-col outline-none">
      <div className="border-b border-gray-alpha-400 px-4 py-3">
        <div className="text-[15px] font-semibold tracking-tight">
          Add {result.title}
          {result.year ? <span className="ml-1.5 font-normal text-gray-900">{result.year}</span> : null}
        </div>
        <div className="text-[12px] text-gray-900">{result.kind === 'series' ? 'Series' : 'Movie'}<Ratings ratings={suggestion.data?.ratings ?? result.ratings} lead /></div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {suggestion.isError ? (
          <ErrorText>{suggestion.error instanceof ApiError ? suggestion.error.message : 'Could not load this title.'}</ErrorText>
        ) : !suggestion.data ? (
          <p className="text-gray-900">Loading…</p>
        ) : (
          <>
            <LookupSummary detail={suggestion.data} series={result.kind === 'series' && <SeriesOverviewLine overview={overview} />} />
            {reasons.length > 0 && (
              <p className="rounded-md bg-gray-alpha-100 px-3 py-2 text-[12px] text-gray-900">Preselected: {reasons.join('; ')}</p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {slotKeys.map((k) => {
                const on = !!picked[k]
                const options = all.filter((p) => p.slot === k && p.enabled)
                return (
                  <div key={k} className="flex h-8 items-center gap-3">
                    <label className="flex w-20 items-center gap-2 text-[13px] font-medium">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setPicked((p) => {
                            const next = { ...p }
                            const fallback = fallbackProfile(all, k, result.kind)
                            if (e.target.checked && fallback) next[k] = fallback
                            else delete next[k]
                            return next
                          })
                        }
                      />
                      {slotLabel[k]}
                    </label>
                    {on && (
                      <Select aria-label={`${slotLabel[k]} Profile`} value={picked[k]} onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.value }))} className="max-w-56">
                        {options.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                )
              })}
            </div>
            {result.kind === 'series' && <SeasonPresets choice={seasons} onChange={setSeasons} series={series} />}
            {roots.length > 1 && (
              <label className="mt-3 flex items-center gap-3 text-[13px]">
                <span className="w-20 font-medium">Folder</span>
                <Select aria-label="Root folder" value={root ?? defaultRoot} onChange={(e) => setRoot(e.target.value)} className="max-w-72">
                  {roots.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </label>
            )}
            {create.isError && (
              <div className="mt-3">
                <ErrorText>{create.error instanceof ApiError ? create.error.message : 'Could not add this title.'}</ErrorText>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-gray-alpha-400 px-4 py-2.5">
        <Button variant="secondary" onClick={onBack}>
          Back
          <span className="ml-2">
            <Kbd>Esc</Kbd>
          </span>
        </Button>
        <div className="flex-1" />
        <Button onClick={add} disabled={!ready}>
          Add
          <span className="ml-2 flex gap-0.5 text-gray-600">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
          </span>
        </Button>
      </footer>
    </div>
  )
}
