// chrome: domain-visual
// A Series' Versions as an accordion of Slots above its Seasons, the Movie's accordion (MovieSection.tsx) with a Series' facts: a
// closed row says the Slot and its Profile, its state, a bar of its episodes, a chip and the size on disk; an open one has the
// Version's facts and its actions. VersionMenu, at the foot of this file, is the "More…" menu both accordions share.
import { Button, DotsMenu, Menu, MenuDivider, MenuItem } from '@hyprsh/design'
import { useEffect, useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import { plural } from '../format'
import { placePath, useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { ago, useNow } from '../time'
import { useReport } from '../toasts'
import { dotState } from '../ui/slotState'
import { size } from './bits'
import { AccordionList, AccordionRow, bodyWrap, Chevron, days, Fact, factsGrid } from './accordion'
import { codeRuns, expandCodes } from './cellDetail'
import { DeleteFile } from './DeleteFiles'
import { useEpisodeView } from './episodeView'
import { importedOn } from './EpisodeFilePopover'
import { AddVersion, ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'
import { SlotChips } from './SlotChip'
import { slotName, slotShort, slotsOf } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { useSearchVersion } from './VersionSearch'
import { WantedLine } from './WantedLine'

type Version = TitleDetail['versions'][number]

type Props = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

/** A Series Version's episodes in words: "55 of 61 episodes · 2 Wanted · 4 not monitored", or what it is downloading. */
function coverageLine(v: Version, dl: SlotDownloads | null): { text: string; tone: string } {
  const c = v.coverage
  if (dl) {
    const eps = dl.items.flatMap((i) => expandCodes(i.episodes))
    return { text: `Downloading${eps.length > 0 ? ` ${codeRuns(eps)}` : ''}`, tone: 'text-blue-900' }
  }
  if (!c) return { text: v.state === 'unmonitored' ? 'Not monitored' : '', tone: 'text-gray-900' }
  const released = c.filled + c.wanted + c.unmonitored
  const parts = [`${c.filled} of ${plural(released, 'episode')}`, c.wanted > 0 ? `${c.wanted} Wanted` : null, c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null].filter(Boolean)
  return { text: parts.join(' \u00b7 '), tone: c.long_missing > 0 ? 'text-red-900' : c.wanted > 0 ? 'text-amber-900' : 'text-gray-900' }
}

/** A bar of a Version's episodes: filled green, downloading blue, Wanted amber, not monitored gray. */
function CoverageBar({ v }: { v: Version }) {
  const c = v.coverage
  if (!c) return null
  const wanted = Math.max(0, c.wanted - c.downloading)
  const parts = [
    ['filled', c.filled, 'bg-green-700'],
    ['downloading', c.downloading, 'bg-blue-700'],
    ['wanted', wanted, 'bg-amber-700'],
    ['unmonitored', c.unmonitored, 'bg-gray-300'],
  ] as const
  return (
    <span aria-hidden className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-gray-100">
      {parts
        .filter(([, n]) => n > 0)
        .map(([k, n, color]) => (
          <span key={k} data-bar={k} style={{ flex: `${n} 0 0` }} className={color} />
        ))}
    </span>
  )
}

/**
 * A Series' Versions block: an accordion of its Slots (Slots with no Version are not drawn; "Add a Slot" adds one while one is
 * free). All rows are closed so the Seasons stay near the top, except that a lone Slot with something Wanted or downloading opens
 * itself; `?slot=` opens and rings a row.
 */
export function VersionRows({ title, profiles, profileName, onManualSearch }: Props) {
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const versions = title.kind === 'series' ? slotsOf(title).flatMap((s) => title.versions.filter((v) => v.slot === s.key)) : []
  const at = useEpisodeView(title.id).slot
  const [open, setOpen] = useState<Set<string>>(() => {
    if (at) return new Set([at])
    const only = versions.length === 1 ? versions[0] : null
    return new Set(only && (downloads.slot(only.slot) || only.state === 'wanted') ? [only.slot] : [])
  })
  useEffect(() => {
    if (!at) return
    setOpen((o) => (o.has(at) ? o : new Set(o).add(at)))
    document.getElementById(`version-${at}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at, title.id])
  const [adding, setAdding] = useState(false)
  if (versions.length === 0) return null
  const toggle = (slot: string) => setOpen((o) => (o.has(slot) ? new Set([...o].filter((x) => x !== slot)) : new Set(o).add(slot)))
  return (
    <section aria-label="Versions" className="my-6 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="heading-16 flex-1">Versions</h3>
        {title.versions.length < 2 && (
          <Button variant="tertiary" size="small" onClick={() => setAdding(true)}>
            Add a Slot
          </Button>
        )}
      </div>
      <AccordionList label="Versions">
        {versions.map((v) => (
          <SlotRow
            key={v.id}
            {...{ title, profiles, profileName, onManualSearch }}
            version={v}
            downloads={downloads.slot(v.slot)}
            now={now}
            open={open.has(v.slot)}
            onToggle={() => toggle(v.slot)}
            marked={at === v.slot}
          />
        ))}
      </AccordionList>
      {adding && <AddVersion title={title} profiles={profiles} onClose={() => setAdding(false)} />}
    </section>
  )
}

function SlotRow({
  version: v,
  downloads,
  now,
  open,
  onToggle,
  marked,
  ...rest
}: Props & { version: Version; downloads: SlotDownloads | null; now: number; open: boolean; onToggle: () => void; marked: boolean }) {
  const phone = usePhone()
  const name = slotName(v.slot)
  const line = coverageLine(v, downloads)
  const c = v.coverage
  const released = c ? c.filled + c.wanted + c.unmonitored : 0
  const state = downloads ? 'downloading' : dotState(v.state, (c?.long_missing ?? 0) > 0 || v.long_missing)
  const sizeText = c && c.size > 0 ? size(c.size) : '\u2014'
  const chip = <SlotChips chips={[{ key: v.slot, short: slotShort(v.slot), state, text: c && released > 0 ? `${c.filled}/${released}` : undefined, tip: `${name}: ${line.text}` }]} max={1} />
  return (
    <AccordionRow
      id={`version-${v.slot}`}
      itemLabel={name}
      label={`${name}: ${line.text}`}
      open={open}
      onToggle={onToggle}
      marked={marked}
      gridClass={phone ? 'grid-cols-[16px_minmax(0,1fr)_auto] min-h-14 py-2.5' : 'grid-cols-[16px_120px_minmax(0,1fr)_auto_72px] h-14'}
      header={
        <>
          <Chevron open={open} />
          <span className="flex min-w-0 flex-col gap-px">
            <span className="label-14 font-semibold">{name}</span>
            <span className="label-12-mono truncate text-gray-900">{rest.profileName(v.profile)}</span>
          </span>
          {!phone && (
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className={`label-13 truncate ${line.tone}`}>{line.text}</span>
              <CoverageBar v={v} />
            </span>
          )}
          <span className="relative flex items-center gap-2">
            {chip}
            {phone && <span className="label-12 text-gray-900">{sizeText}</span>}
          </span>
          {!phone && <span className="label-13 pointer-events-none text-right text-gray-900 tabular-nums">{sizeText}</span>}
          {phone && (
            <span className="col-start-2 col-end-4 flex min-w-0 flex-col gap-1.5">
              <span className={`label-12 truncate ${line.tone}`}>{line.text}</span>
              <CoverageBar v={v} />
            </span>
          )}
        </>
      }
      body={<SlotBody {...rest} version={v} downloads={downloads} now={now} />}
    />
  )
}

function SlotBody({ title, profiles, profileName, onManualSearch, version: v, downloads, now }: Props & { version: Version; downloads: SlotDownloads | null; now: number }) {
  const openPlace = useOpenPlace()
  const search = useSearchVersion(title, v.id)
  const [whyOpen, setWhyOpen] = useState(false)
  const c = v.coverage
  const released = c ? c.filled + c.wanted + c.unmonitored : 0
  const manual = () => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })
  const wanted = v.state === 'wanted' && !downloads
  const d = days(v.wanted_since, now)
  return (
    <div className={bodyWrap}>
      <OriginalOfferNote offer={v.original_offer} />
      <div className={factsGrid}>
        <Fact k="Profile">{profileName(v.profile)}</Fact>
        <Fact k="Coverage">
          {c
            ? `${c.filled} of ${plural(released, 'episode')}${c.long_missing > 0 ? ` \u00b7 ${c.long_missing} Long Missing` : ''}${c.unmonitored > 0 ? ` \u00b7 ${c.unmonitored} not monitored` : ''}`
            : '\u2014'}
        </Fact>
        <Fact k="Wanted since">{v.wanted_since ? `${importedOn(v.wanted_since)} \u00b7 ${d >= 1 ? plural(d, 'day') : 'today'}` : '\u2014'}</Fact>
        <Fact k="Size on disk">{c && c.size > 0 ? size(c.size) : '\u2014'}</Fact>
        {wanted && (
          <Fact k="Search" wide>
            <WantedLine version={v} now={now} open={whyOpen} onOpenChange={setWhyOpen} searching={search.pending || unmonitored(title)} onSearch={search.run} onManualSearch={manual} />
          </Fact>
        )}
        {downloads && (
          <Fact k="Downloading" wide>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {downloads.items.map((g) => (
                <Button key={g.grab_id} variant="tertiary" size="tiny" title={g.release_name} onClick={() => openPlace(placePath('activity'))}>
                  {`${g.episodes.length > 0 ? codeRuns(expandCodes(g.episodes)) : g.release_name} \u00b7 ${ago(g.grabbed_at, now)}`}
                </Button>
              ))}
              {downloads.pct !== null && <span className="text-blue-900">{`${downloads.pct}%`}</span>}
            </span>
          </Fact>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="default" size="small" disabled={unmonitored(title) || search.pending || !(c ? c.wanted > 0 : wanted)} onClick={search.run}>
          Search Wanted
        </Button>
        <Button variant="tertiary" size="small" onClick={manual}>
          Manual search
        </Button>
        <span className="flex-1" />
        <VersionMenu {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads} onWhy={() => setWhyOpen(true)} more />
      </div>
    </div>
  )
}

/**
 * A Version's "…" menu and what its items open: Search now, Manual search, Change Profile, Why is it Wanted? while it is Wanted,
 * Cancel download while it downloads, Delete files (a Movie's file) and Remove Version. Nothing here is the Version's one next action; that sits beside it.
 */
export function VersionMenu({
  title,
  version: v,
  profiles,
  profileName,
  onManualSearch,
  downloads,
  onWhy,
  more,
}: Props & { version: Version; downloads: SlotDownloads | null; onWhy?: () => void; /** Draws the menu's button as "More…" (a Movie's open Slot) instead of the ⋯ icon. */ more?: boolean }) {
  const sw = useSwitchProfile(v.id)
  const report = useReport()
  const rm = useRemoveVersion(v.id)
  const search = useSearchVersion(title, v.id)
  const cancel = useCancelDownloads()
  const [mode, setMode] = useState<'switch' | 'remove' | 'delete' | null>(null)
  const movie = title.kind === 'movie'
  const name = slotName(v.slot)
  const items = (
    <>
      <MenuItem disabled={unmonitored(title) || search.pending} description={unmonitored(title) ? 'Not monitored: turn monitoring on to search' : undefined} onSelect={search.run}>
        Search now
      </MenuItem>
      <MenuItem onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>Manual search…</MenuItem>
      <MenuItem suffix={<span className="label-12-mono text-gray-900">{profileName(v.profile)}</span>} onSelect={() => setMode('switch')}>
        Change Profile…
      </MenuItem>
      {v.state === 'wanted' && onWhy && <MenuItem onSelect={onWhy}>Why is it Wanted?</MenuItem>}
      {downloads && (
        <>
          <MenuDivider />
          <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, false)}>
            {downloads.items.length === 1 ? 'Cancel download' : 'Cancel downloads'}
          </MenuItem>
          <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, true)}>
            Cancel and blocklist
          </MenuItem>
        </>
      )}
      <MenuDivider />
      {movie && (
        <MenuItem type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={() => setMode('delete')}>
          Delete files…
        </MenuItem>
      )}
      <MenuItem type="error" onSelect={() => setMode('remove')}>
        Remove Version…
      </MenuItem>
    </>
  )
  return (
    <>
      {more ? (
        <Menu.Container position="bottom-end">
          <Menu.Button variant="tertiary" size="small" aria-label={`${name} Version actions`}>
            More…
          </Menu.Button>
          <Menu width={260} aria-label={`${name} Version actions`}>
            {items}
          </Menu>
        </Menu.Container>
      ) : (
        <DotsMenu aria-label={`${name} Version actions`}>{items}</DotsMenu>
      )}
      {mode === 'switch' && (
        <ProfilePicker
          profiles={profiles}
          slot={v.slot}
          initial={v.profile}
          label="Change Profile"
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
      <DeleteFile versionId={v.id} file={v.file} asking={mode === 'delete'} onClose={() => setMode(null)} />
    </>
  )
}
