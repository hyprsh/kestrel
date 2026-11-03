import { Button, CommandMenuGroup, CommandMenuInput, CommandMenuList, Note, Separator, Skeleton, TitleBar } from '@hyprsh/design'
import { Ban, Bookmark, ChevronRight, Folder, Layers, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject, type TouchEvent } from 'react'
import { ApiError, useCreateTitle, useLookupDetail, useProfiles, useSeriesOverview, useSettings, type LookupResult, type TitleCreate } from '../api/queries'
import { useSlotNames } from '../library/slots'
import { orderSeasons, seasonName } from '../library/episodes'
import { useDisplay } from '../display/useDisplay'
import { LoadingRegion } from '../loading'
import { Ratings } from '../library/Ratings'
import { Poster } from '../poster'
import { usePhone } from '../responsive'
import {
  allEpisodes,
  createBody,
  factsLine,
  monitorClause,
  monitorText,
  pick,
  pickedFrom,
  presetLabel,
  presetNote,
  presets,
  profileOf,
  seasonsOf,
  unavailable,
  versionsOf,
  type Library,
  type Preset,
  type SeasonChoice,
} from './addModel'
import { Hints, Row } from './Rows'

/** A list a Title page drills into. */
export type Choice = { id: 'slot'; slot: string } | { id: 'monitor' } | { id: 'seasons' } | { id: 'root' }

/** What adding a Title did, for the Toast that confirms it. */
export type Added = { id: number; title: string; summary: string }

const sentence = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)

/** The name of a choice list: the crumb after the Title's, and a phone's page heading. */
export function useChoiceLabel() {
  const slots = useSlotNames()
  return (c: Choice) => (c.id === 'slot' ? slots.name(c.slot) : c.id === 'monitor' ? 'Monitor' : c.id === 'seasons' ? 'Pick Seasons' : 'Root Folder')
}

const matches = (query: string, ...text: (string | undefined)[]) => {
  const hay = text.join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

/**
 * A search result as a page inside the menu: its poster, facts and overview over one row per choice (each Slot with its Profile,
 * Monitor, Root Folder) and the row that adds it. A choice opens its own list; `trail` is the lists opened so far. The choices start
 * as Kestrel would add the Title (the suggested Slots and their default Profiles, all episodes, the first root folder), and the
 * ones changed say so. The Slot defaults, the fallback Profile and the 422 mapping are what the old add panel had.
 */
export function AddFlow({
  result,
  trail,
  query,
  inputRef,
  addRef,
  onPush,
  onPop,
  onAdded,
}: {
  result: LookupResult
  trail: Choice[]
  query: string
  inputRef: RefObject<HTMLInputElement | null>
  /** Receives the function that adds with the choices as they stand (⌘↵ on the page). */
  addRef: MutableRefObject<(() => void) | null>
  onPush: (c: Choice) => void
  onPop: () => void
  onAdded: (a: Added) => void
}) {
  const phone = usePhone()
  const suggestion = useLookupDetail(result.kind, result.tmdb_id)
  const overview = useSeriesOverview(result.tmdb_id, result.kind === 'series')
  const series = overview.data ?? null
  const profiles = useProfiles()
  const slots = useSlotNames()
  const settings = useSettings()
  const create = useCreateTitle()
  const choiceLabel = useChoiceLabel()
  const { display } = useDisplay()
  const wrap = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<Partial<Record<string, string>>>({})
  const [seeded, setSeeded] = useState(false)
  const [root, setRoot] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<SeasonChoice>(allEpisodes)

  // Seed the choices once from the server's suggestion; after that the user's edits stand.
  useEffect(() => {
    if (seeded || !suggestion.data) return
    setPicked(pickedFrom(suggestion.data))
    setSeeded(true)
  }, [seeded, suggestion.data])

  const all = useMemo(() => profiles.data ?? [], [profiles.data])
  const enabled = all.filter((p) => p.enabled) // any Profile can fill any Slot
  const lib: Library = { kind: result.kind, profiles: all, slots }
  const folders = settings.data?.root_folders
  const roots = (result.kind === 'series' ? folders?.series : folders?.movies) ?? []
  // The server files a new Title in the kind's first root folder when none is named.
  const defaultRoot = roots[0]
  const single = slots.list.length === 1
  const versions = versionsOf(picked, lib)
  const suggested = pickedFrom(suggestion.data)
  const kindWord = result.kind === 'series' ? 'Series' : 'Movie'
  const ready = seeded && versions.length > 0 && !create.isPending

  const nameOfProfile = (key: string | undefined) => all.find((p) => p.key === key)?.name ?? key ?? ''
  const profileChanged = (k: string) => profileOf(picked, k, lib) !== (suggested[k] ?? (single ? profileOf({}, k, lib) : undefined))
  // A 422 on `versions[i].profile` (profile_taken) belongs to the Profile of the i-th Slot sent.
  const profileError = (k: string) =>
    create.error instanceof ApiError ? create.error.fields.find((f) => f.field === `versions[${versions.findIndex((v) => v.slot === k)}].profile`)?.message : undefined
  const monitorChanged = seasons.preset !== 'all'
  const rootChanged = root !== null && root !== defaultRoot

  const summary = [
    sentence(versions.map((v) => slots.name(v.slot))),
    sentence([...new Set(versions.map((v) => nameOfProfile(v.profile)))]),
    result.kind === 'series' ? monitorClause(seasons, series) : '',
    root ?? defaultRoot ?? '',
  ]
    .filter(Boolean)
    .join(' · ')

  const add = () => {
    if (!ready) return
    const body: TitleCreate = createBody(result, versions, seasons, series, root)
    create.mutateAsync(body).then(
      (title) =>
        onAdded({
          id: title.id,
          title: result.title,
          summary: [sentence(versions.map((v) => slots.name(v.slot))), result.kind === 'series' ? monitorClause(seasons, series) : ''].filter(Boolean).join(' · '),
        }),
      () => {}, // shown on the page
    )
  }
  useEffect(() => {
    addRef.current = add
    return () => {
      addRef.current = null
    }
  })

  const level = trail.at(-1)
  // A page slides in from the right on a phone, and the one below it returns from the left.
  const depth = useRef(-1)
  const dir = trail.length >= depth.current ? 'cmd-push' : 'cmd-pop'
  useEffect(() => {
    depth.current = trail.length
  })
  // The input is gone on a phone's page and lists, and a row click takes focus off it: put focus where the keys work.
  useEffect(() => {
    if (phone) wrap.current?.closest<HTMLElement>('[role="dialog"]')?.focus()
    else inputRef.current?.focus()
  }, [phone, trail.length, inputRef])

  // ---- The rows of each list ----

  const choose = (apply: () => void) => () => {
    apply()
    onPop()
  }

  const pageRows = () => {
    const rows: ReactNode[] = []
    for (const r of slots.list) {
      const on = !!profileOf(picked, r.id, lib)
      const changed = profileChanged(r.id)
      const err = profileError(r.id)
      const sub = err ? <span className="text-red-900">{err}</span> : on ? `Profile ${nameOfProfile(profileOf(picked, r.id, lib))}${changed ? '' : ' · the default'}` : 'Not added'
      if (!matches(query, slots.name(r.id), typeof sub === 'string' ? sub : '')) continue
      rows.push(
        <Row
          key={`slot-${r.id}`}
          icon={<Layers />}
          title={slots.name(r.id)}
          sub={sub}
          trail={changed ? 'Changed' : on ? 'On' : 'Off'}
          trailTone={changed ? 'accent' : undefined}
          chevron={phone}
          run={() => onPush({ id: 'slot', slot: r.id })}
        />,
      )
    }
    if (result.kind === 'series' && matches(query, 'Monitor', monitorText(seasons, series))) {
      rows.push(
        <Row
          key="monitor"
          icon={<Bookmark />}
          title="Monitor"
          sub={monitorText(seasons, series)}
          trail={monitorChanged ? 'Changed' : 'Default'}
          trailTone={monitorChanged ? 'accent' : undefined}
          chevron={phone}
          run={() => onPush({ id: 'monitor' })}
        />,
      )
    }
    if (roots.length > 0 && matches(query, 'Root Folder', root ?? defaultRoot)) {
      rows.push(
        <Row
          key="root"
          icon={<Folder />}
          title="Root Folder"
          sub={root ?? defaultRoot}
          trail={rootChanged ? 'Changed' : 'Default'}
          trailTone={rootChanged ? 'accent' : undefined}
          chevron={phone}
          run={() => onPush({ id: 'root' })}
        />,
      )
    }
    return (
      <>
        {rows.length > 0 && <CommandMenuGroup heading="Choices">{rows}</CommandMenuGroup>}
        {!phone && (
          <CommandMenuGroup>
            <Row icon={<Plus />} title={`Add ${kindWord}`} sub={versions.length === 0 ? 'Switch on a Slot to add it' : summary} keys={[{ meta: true, key: '↵' }]} disabled={!ready} run={add} />
          </CommandMenuGroup>
        )}
      </>
    )
  }

  const slotRows = (k: string) => {
    const current = profileOf(picked, k, lib)
    const rec = slots.list.find((r) => r.id === k)
    const def = result.kind === 'series' ? rec?.default_series : rec?.default_movies
    return (
      <CommandMenuGroup>
        {!single && (
          <Row
            icon={<Ban />}
            title="Off"
            sub={`No Version in ${slots.name(k)}`}
            check={!current}
            run={choose(() => setPicked((p) => Object.fromEntries(Object.entries(p).filter(([s]) => s !== k))))}
          />
        )}
        {enabled.map((p) => {
          const user = slots.list.find((r) => r.id !== k && profileOf(picked, r.id, lib) === p.key)
          return (
            <Row
              key={p.key}
              icon={<Layers />}
              title={p.name}
              sub={user ? `Used by ${slots.name(user.id)}` : p.key === def ? `The default for a ${kindWord}` : undefined}
              check={p.key === current}
              run={choose(() => setPicked((s) => ({ ...s, [k]: p.key })))}
            />
          )
        })}
      </CommandMenuGroup>
    )
  }

  const monitorRows = () => {
    const why = unavailable(overview)
    const has = (n: number) => !!series?.seasons.some((s) => s.number === n)
    const off: Record<Preset, boolean> = { all: false, future: false, none: false, first: !has(1), latest: !series?.latest_season, pick: !series }
    return (
      <CommandMenuGroup>
        {presets.map((p) => (
          <Row
            key={p}
            icon={<Bookmark />}
            title={p === 'latest' && series?.latest_season ? `${presetLabel.latest} (${series.latest_season})` : presetLabel[p]}
            sub={off[p] && why ? why : presetNote[p]}
            check={seasons.preset === p}
            disabled={off[p]}
            chevron={p === 'pick'}
            run={p === 'pick' ? () => (setSeasons(pick(seasons, series)), onPush({ id: 'seasons' })) : choose(() => setSeasons({ ...seasons, preset: p }))}
          />
        ))}
      </CommandMenuGroup>
    )
  }

  const seasonRows = () => {
    if (!series) return null
    const ticked = seasonsOf(seasons, series) ?? []
    const order = orderSeasons(
      series.seasons.map((s) => s.number),
      display.season_order,
    )
    const toggle = (n: number) => {
      const p = pick(seasons, series)
      setSeasons({ ...p, picked: p.picked.includes(n) ? p.picked.filter((x) => x !== n) : [...p.picked, n] })
    }
    return (
      <>
        <CommandMenuGroup>
          <Row
            icon={<Bookmark />}
            title="Follow New Seasons"
            sub="Seasons that air later are monitored too"
            check={seasons.follow}
            run={() => setSeasons({ ...pick(seasons, series), follow: !seasons.follow })}
          />
        </CommandMenuGroup>
        <CommandMenuGroup heading="Seasons">
          {order
            .flatMap((n) => series.seasons.filter((s) => s.number === n))
            .map((s) => (
              <Row
                key={s.number}
                icon={<Layers />}
                title={seasonName(s.number)}
                sub={`${s.episodes} ${s.episodes === 1 ? 'episode' : 'episodes'}${s.first_aired ? ` · ${s.first_aired.slice(0, 4)}` : ' · not aired yet'}`}
                check={ticked.includes(s.number)}
                run={() => toggle(s.number)}
              />
            ))}
        </CommandMenuGroup>
      </>
    )
  }

  const rootRows = () => (
    <CommandMenuGroup>
      {roots.map((r) => (
        <Row
          key={r}
          icon={<Folder />}
          title={r}
          sub={r === defaultRoot ? 'Where Kestrel files it unless told otherwise' : undefined}
          check={r === (root ?? defaultRoot)}
          run={choose(() => setRoot(r === defaultRoot ? null : r))}
        />
      ))}
    </CommandMenuGroup>
  )

  const list = !level ? pageRows() : level.id === 'slot' ? slotRows(level.slot) : level.id === 'monitor' ? monitorRows() : level.id === 'seasons' ? seasonRows() : rootRows()

  // ---- The page ----

  const crumbs = [result.title, ...trail.map(choiceLabel)]
  const head = level ? choiceLabel(level) : result.title
  const detail = suggestion.data
  const loading = suggestion.isPending && !level
  const edge = (e: TouchEvent) => {
    if (e.type === 'touchstart') {
      const t = e.touches[0]
      swipe.current = t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null
    } else if (swipe.current) {
      const t = e.changedTouches[0]
      const s = swipe.current
      swipe.current = null
      if (t.clientX - s.x > 72 && Math.abs(t.clientY - s.y) < 60) onPop()
    }
  }

  return (
    <div key={trail.length} ref={wrap} className={`cmd-level ${dir} flex min-h-0 flex-1 flex-col`} onTouchStart={phone ? edge : undefined} onTouchEnd={phone ? edge : undefined}>
      {phone ? (
        <TitleBar hideFrom={false} opaque back={{ label: trail.length > 1 ? `Back to ${crumbs.at(-2)}` : level ? `Back to ${result.title}` : 'Back to Results', onClick: onPop }} title={head} />
      ) : (
        <CommandMenuInput
          prefix={
            <span className="flex items-center gap-1.5">
              {crumbs.map((c, i) => (
                <span key={i} className="label-14 flex items-center gap-1.5 whitespace-nowrap text-gray-1000">
                  {c}
                  <ChevronRight aria-hidden className="size-3.5 text-gray-700" />
                </span>
              ))}
            </span>
          }
          aria-label={level ? crumbs.join(' › ') : `Filter the choices for ${result.title}`}
          placeholder={level ? 'Filter…' : 'Filter the choices…'}
          hideClose
        />
      )}
      {!level && (
        <div className="shrink-0">
          <div className="flex gap-3.5 px-4 py-3.5">
            <Poster src={detail?.poster ?? result.poster} alt={`${result.title} poster`} size={phone ? 'sheet' : 'brief'} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="heading-16">
                {result.title}
                {result.year ? <span className="label-14 ml-1.5 text-gray-900">{result.year}</span> : null}
              </div>
              <p className="label-12 text-gray-900">
                {factsLine(result, series)}
                <Ratings ratings={detail?.ratings ?? result.ratings} lead />
              </p>
              {detail ? (
                detail.overview && <p className="label-12 line-clamp-2 text-gray-900">{detail.overview}</p>
              ) : suggestion.isError ? null : (
                <LoadingRegion label="Loading the Title">
                  <Skeleton width="90%" height={14} />
                </LoadingRegion>
              )}
            </div>
          </div>
          <Separator />
        </div>
      )}
      {!level && result.kind === 'series' && overview.error && (
        <div className="shrink-0 px-3 pt-2">
          <Note variant="warning" size="small">
            Could not load the series overview{overview.error instanceof ApiError ? `: ${overview.error.message}` : '.'} Season choices are off.
          </Note>
        </div>
      )}
      {create.isError && (
        <div className="shrink-0 px-3 pt-2">
          <Note variant="error" size="small">
            {create.error instanceof ApiError ? create.error.message : 'Could not add this Title.'}
          </Note>
        </div>
      )}
      <CommandMenuList
        empty={
          suggestion.isError ? (
            <Note variant="error" size="small">
              {suggestion.error instanceof ApiError ? suggestion.error.message : 'Could not load this Title.'}
            </Note>
          ) : undefined
        }
      >
        {loading ? (
          <LoadingRegion label="Loading the choices">
            <div aria-hidden className="flex flex-col gap-3 p-2">
              <Skeleton height={36} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          </LoadingRegion>
        ) : suggestion.isError && !level ? null : (
          list
        )}
      </CommandMenuList>
      {phone && !level && (
        <div className="shrink-0">
          <Separator />
          <div className="flex flex-col gap-2 px-4 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
            <span className="label-12 text-center text-gray-900">{versions.length === 0 ? 'Switch on a Slot to add it' : summary}</span>
            <Button variant="primary" size="large" className="w-full" onClick={add} disabled={!ready} loading={create.isPending}>
              {`Add ${kindWord}`}
            </Button>
          </div>
        </div>
      )}
      <Hints
        hints={
          level
            ? [
                { label: 'Choose', keys: [{ key: '↵' }] },
                { label: 'Back', keys: [{ key: 'Esc' }] },
              ]
            : [
                { label: 'Change', keys: [{ key: '↵' }] },
                { label: `Add ${kindWord}`, keys: [{ meta: true, key: '↵' }] },
                { label: 'Back', keys: [{ key: 'Esc' }] },
              ]
        }
      />
    </div>
  )
}
