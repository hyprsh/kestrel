// chrome: domain-visual
// A Series' Versions as an accordion of Slots above its Seasons, the Movie's accordion (MovieSection.tsx) with a Series' facts: a
// row is one line saying the Slot and its Profile, its state, a bar of its episodes, their count and the size on disk; an open
// one adds the Version's facts and its actions. VersionMenu, at the foot of this file, is the "More…" menu both accordions share.
import { Button, DotsMenu, Menu, MenuDivider, MenuItem, Progress } from '@hyprsh/design'
import { useEffect, useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import type { QueueItem } from '../api/queue'
import { percent, plural } from '../format'
import { placePath, useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { ago, span, useNow } from '../time'
import { useReport } from '../toasts'
import { barColor, chipColumn, StateBar } from './StateBar'
import { size } from './bits'
import { AccordionList, AccordionRow, BarCell, bodyWrap, Chevron, Count, CountCell, days, Fact, factsGrid, lineRow, phoneRow, RowName, SizeCell, StandingText } from './accordion'
import { codeRuns, expandCodes } from './cellDetail'
import { DeleteFile } from './DeleteFiles'
import { useEpisodeView } from './episodeView'
import { importedOn } from './EpisodeFilePopover'
import { AddVersion, ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'
import { slotsOf, useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { VersionActions } from './VersionActions'
import { useSearchVersion } from './VersionSearch'
import { WantedLine } from './WantedLine'

type Version = TitleDetail['versions'][number]

type Props = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

/** A Series Version's episodes in words, apart from the count beside its bar: "Complete", "2 Wanted · 4 not monitored", or what it is downloading. */
function coverageLine(v: Version, dl: SlotDownloads | null): { text: string; tone: string } {
  const c = v.coverage
  if (dl) {
    const eps = dl.items.flatMap((i) => expandCodes(i.episodes))
    return { text: `Downloading${eps.length > 0 ? ` ${codeRuns(eps)}` : ''}`, tone: 'text-blue-900' }
  }
  if (!c) return { text: v.state === 'unmonitored' ? 'Not monitored' : '', tone: 'text-gray-900' }
  const parts = [c.wanted > 0 ? `${c.wanted} Wanted` : null, c.long_missing > 0 ? `${c.long_missing} Long Missing` : null, c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null].filter(Boolean)
  return { text: parts.length > 0 ? parts.join(' \u00b7 ') : 'Complete', tone: c.long_missing > 0 ? 'text-red-900' : c.wanted > 0 ? 'text-amber-900' : 'text-gray-900' }
}

/** A bar of a Version's episodes: Have gray, downloading blue, Wanted amber, Long Missing red, not monitored light gray; thin when it is complete. */
function CoverageBar({ v }: { v: Version }) {
  const c = v.coverage
  if (!c) return null
  // The segments are disjoint: Long Missing counts once, here, not again as Wanted (a Grab in flight makes it downloading).
  const long = Math.max(0, c.long_missing - c.downloading_long_missing)
  const wanted = Math.max(0, c.wanted - c.downloading - long)
  const parts = [
    { key: 'filled', n: c.filled, color: barColor.filled },
    { key: 'downloading', n: c.downloading, color: barColor.downloading },
    { key: 'wanted', n: wanted, color: barColor.wanted },
    { key: 'long_missing', n: long, color: barColor.longMissing },
    { key: 'unmonitored', n: c.unmonitored, color: barColor.quiet },
  ]
  return <StateBar parts={parts} complete={c.filled > 0 && c.wanted === 0 && c.downloading === 0 && c.unmonitored === 0} />
}

/** One running Grab of a Slot on a line: the episodes it covers, its progress and time left, and a link into Activity. */
function GrabLine({ grab: g, slotName, now, onActivity }: { grab: QueueItem; slotName: string; now: number; onActivity: () => void }) {
  const what = g.episodes.length > 0 ? codeRuns(expandCodes(g.episodes)) : g.release_name
  const pct = percent(g.bytes_total, g.phase === 'importing' ? 0 : g.bytes_left)
  const progress = [pct !== null ? `${pct}%` : null, g.eta != null ? `${span(g.eta * 1000)} left` : null].filter(Boolean).join(' \u00b7 ')
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-x-3 gap-y-1 max-sm:grid-cols-[minmax(0,1fr)_auto]">
      <span className="label-13 truncate" title={g.release_name}>
        {what}
        <span className="text-gray-900">{` \u00b7 ${ago(g.grabbed_at, now)}`}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2 max-sm:order-last max-sm:col-span-2">
        {pct !== null && (
          <span className="min-w-12 flex-1">
            <Progress value={pct} type="success" height={6} aria-label={`${slotName} ${what} download progress`} />
          </span>
        )}
        {progress && <span className="label-13 whitespace-nowrap text-blue-900 tabular-nums">{progress}</span>}
      </span>
      <Button variant="tertiary" size="tiny" aria-label={`${what} in Activity`} onClick={onActivity}>
        Activity
      </Button>
    </li>
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
  const slots = useSlotNames()
  const versions = title.kind === 'series' ? slotsOf(title, slots).flatMap((s) => title.versions.filter((v) => v.slot === s.key)) : []
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
    <section aria-label="Versions" className="my-6 flex flex-col gap-2" style={chipColumn(versions.length)}>
      <div className="flex items-center gap-2">
        <h3 className="heading-16 flex-1">Versions</h3>
        {title.versions.length < slots.list.length && (
          <Button variant="secondary" size="small" onClick={() => setAdding(true)}>
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
  const slots = useSlotNames()
  const name = slots.name(v.slot)
  const line = coverageLine(v, downloads)
  const c = v.coverage
  const released = c ? c.episodes + c.unmonitored : 0
  // The row's name and the chip's tooltip say all of it, count included: "Standard: 228 of 240 episodes · 8 Wanted".
  const said = `${name}: ${c && !downloads ? `${c.filled} of ${plural(released, 'episode')}${line.text === 'Complete' ? '' : ` \u00b7 ${line.text}`}` : line.text}`
  const sizeText = c && c.size > 0 ? size(c.size) : '\u2014'
  // The row says all of it on one line, open or closed: name and Profile, the state text, the bar, the count and the size. The count
  // is mono text (the Slot's name and state are already on the row), so a Version has no chip; the facts below add the detail.
  const count = c && released > 0 ? `${c.filled}/${released}` : ''
  const bar = <CoverageBar v={v} />
  return (
    <AccordionRow
      id={`version-${v.slot}`}
      itemLabel={name}
      label={said}
      open={open}
      onToggle={onToggle}
      marked={marked}
      rowClass={phone ? phoneRow : lineRow}
      header={
        <>
          <Chevron open={open} />
          {phone ? (
            <>
              <RowName name={name} tag={rest.profileName(v.profile)} />
              <SizeCell text={sizeText} />
              <span className="pointer-events-none col-start-2 col-end-4 mt-1 flex min-w-0 items-center gap-2">
                <StandingText text={line.text} tone={line.tone} className="flex-1" />
                <BarCell className="w-24">{bar}</BarCell>
                {count && <Count text={count} tip={said} />}
              </span>
            </>
          ) : (
            <>
              <RowName name={name} tag={rest.profileName(v.profile)} />
              <StandingText text={line.text} tone={line.tone} />
              <BarCell>{bar}</BarCell>
              <CountCell>{count && <Count text={count} tip={said} />}</CountCell>
              <SizeCell text={sizeText} />
            </>
          )}
        </>
      }
      body={<SlotBody {...rest} version={v} downloads={downloads} now={now} />}
    />
  )
}

function SlotBody({ title, profiles, profileName, onManualSearch, version: v, downloads, now }: Props & { version: Version; downloads: SlotDownloads | null; now: number }) {
  const openPlace = useOpenPlace()
  const slotName = useSlotNames().name(v.slot)
  const search = useSearchVersion(title, v.id)
  const [whyOpen, setWhyOpen] = useState(false)
  const c = v.coverage
  const released = c ? c.episodes + c.unmonitored : 0
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
            ? `${c.filled} of ${plural(released, 'episode')}${c.wanted > 0 && !downloads ? ` \u00b7 ${c.wanted} Wanted` : ''}${c.long_missing > 0 ? ` \u00b7 ${c.long_missing} Long Missing` : ''}${c.unmonitored > 0 ? ` \u00b7 ${c.unmonitored} not monitored` : ''}`
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
          <Fact k="Downloading" full>
            <ul className="flex flex-col gap-2">
              {downloads.items.map((g) => (
                <GrabLine key={g.grab_id} grab={g} slotName={slotName} now={now} onActivity={() => openPlace(placePath('activity'))} />
              ))}
            </ul>
          </Fact>
        )}
      </div>
      <VersionActions
        primary={
          <Button variant="default" size="small" disabled={unmonitored(title) || search.pending || !(c ? c.wanted > 0 : wanted)} onClick={search.run}>
            Search Wanted
          </Button>
        }
        secondary={
          <Button variant="tertiary" size="small" onClick={manual}>
            Manual Search
          </Button>
        }
        more={<VersionMenu {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads} onWhy={() => setWhyOpen(true)} more />}
      />
    </div>
  )
}

/**
 * A Version's "…" menu and what its items open: Search now, Manual search, Change Profile, Why Is It Wanted? while it is Wanted,
 * Cancel Download while it downloads, Delete files (a Movie's file) and Remove Version. Nothing here is the Version's one next action; that sits beside it.
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
  const name = useSlotNames().name(v.slot)
  const items = (
    <>
      <MenuItem disabled={unmonitored(title) || search.pending} description={unmonitored(title) ? 'Not monitored: turn monitoring on to search' : undefined} onSelect={search.run}>
        Search Now
      </MenuItem>
      <MenuItem onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>Manual Search…</MenuItem>
      <MenuItem suffix={<span className="label-12-mono text-gray-900">{profileName(v.profile)}</span>} onSelect={() => setMode('switch')}>
        Change Profile…
      </MenuItem>
      {v.state === 'wanted' && onWhy && <MenuItem onSelect={onWhy}>Why Is It Wanted?</MenuItem>}
      {downloads && (
        <>
          <MenuDivider />
          <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, false)}>
            {downloads.items.length === 1 ? 'Cancel Download' : 'Cancel Downloads'}
          </MenuItem>
          <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, true)}>
            Cancel and Blocklist
          </MenuItem>
        </>
      )}
      <MenuDivider />
      {movie && (
        <MenuItem type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={() => setMode('delete')}>
          Delete Files…
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
