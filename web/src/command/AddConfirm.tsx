import { CornerDownLeft } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError, useCreateTitle, useLookupDetail, useProfiles, useSettings, type LookupResult, type Profile, type SeriesMonitor } from '../api/queries'
import { Button, ErrorText, Select } from '../forms'
import { slotKeys, slotLabel, type SlotKey } from '../library/bits'
import { Kbd } from '../ui'

/** The Profile a Slot gets when ticked without a suggestion: its default, else the first enabled Primary-Language one. */
function fallbackProfile(profiles: Profile[], slot: SlotKey, kind: 'movie' | 'series'): string | undefined {
  const of = profiles.filter((p) => p.slot === slot && p.enabled)
  return (of.find((p) => (kind === 'series' ? p.default_series : p.default_movies)) ?? of.find((p) => p.language_rule === 'primary' && !p.kids) ?? of[0])?.key
}

/**
 * The add panel: every Slot with a default is preselected, with the reason
 * ("HD · Kids (FSK 6) — Kids rule"). One key (Enter) adds; Slots and Profiles
 * can be changed first.
 */
export function AddConfirm({ result, onBack, onAdded }: { result: LookupResult; onBack: () => void; onAdded: (titleId: number) => void }) {
  const suggestion = useLookupDetail(result.kind, result.tmdb_id)
  const profiles = useProfiles()
  const settings = useSettings()
  const create = useCreateTitle()
  const panel = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<Partial<Record<SlotKey, string>>>({})
  const [seeded, setSeeded] = useState(false)
  const [root, setRoot] = useState<string | null>(null)
  const [monitor, setMonitor] = useState<SeriesMonitor>('all')

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
  // A Title whose HD Profile is a Kids one goes in the kind's Kids root folder, as the server does when none is named.
  const kidsRoot = result.kind === 'series' ? folders?.kids_series : folders?.kids_movies
  const defaultRoot = kidsRoot && all.find((p) => p.key === picked.hd)?.kids ? kidsRoot : roots[0]
  const chosen = slotKeys.filter((k) => picked[k])
  const ready = seeded && chosen.length > 0 && !create.isPending

  const add = () => {
    if (!ready) return
    create.mutate(
      {
        kind: result.kind,
        tmdb_id: result.tmdb_id,
        versions: chosen.map((slot) => ({ slot, profile: picked[slot]! })),
        ...(result.kind === 'series' ? { series_monitor: monitor } : {}),
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
    (s) => `${slotLabel[s.slot]} · ${s.label}${s.reason === 'kids_rule' ? ' — Kids rule' : ' (default)'}`,
  )

  return (
    <div ref={panel} tabIndex={-1} onKeyDown={onKeyDown} className="flex min-h-0 flex-col outline-none">
      <div className="border-b border-gray-alpha-400 px-4 py-3">
        <div className="text-[15px] font-semibold tracking-tight">
          Add {result.title}
          {result.year ? <span className="ml-1.5 font-normal text-gray-900">{result.year}</span> : null}
        </div>
        <div className="text-[12px] text-gray-900">{result.kind === 'series' ? 'Series' : 'Movie'}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {suggestion.isError ? (
          <ErrorText>{suggestion.error instanceof ApiError ? suggestion.error.message : 'Could not load this title.'}</ErrorText>
        ) : !suggestion.data ? (
          <p className="text-gray-900">Loading…</p>
        ) : (
          <>
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
            {result.kind === 'series' && (
              <label className="mt-3 flex items-center gap-3 text-[13px]">
                <span className="w-20 font-medium">Monitor</span>
                <Select aria-label="Monitor" value={monitor} onChange={(e) => setMonitor(e.target.value as SeriesMonitor)} className="max-w-56">
                  <option value="all">All episodes</option>
                  <option value="future">Future episodes only</option>
                  <option value="none">None</option>
                </Select>
              </label>
            )}
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
