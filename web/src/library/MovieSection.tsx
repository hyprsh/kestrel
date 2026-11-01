// What a Movie adds to its Title page, below its Versions: the Files table, one row per Slot. A row is named by the file on disk
// (its name cut at its start, the release it was grabbed as under it), then the quality, size and import date, with File details
// and the ⋯ menu on hover. A Slot with no file says why it is Wanted; a download shows its progress. A phone gets rows of two lines.
import { Button, DotsMenu, MenuItem, StatusDot, Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from '@hyprsh/design'
import { FileVideo, Search } from 'lucide-react'
import { useState } from 'react'
import type { TitleDetail } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { ago, useNow } from '../time'
import { dotOf, faintDot, size, slotKeys, slotLabel, versionStatus } from './bits'
import { baseName, cellText } from './cellDetail'
import { DeleteFile } from './DeleteFiles'
import { FileDetailsPopover, importedOn } from './EpisodeFilePopover'
import { IconAction, rowActionsShown } from './IconAction'
import { qualityName } from './media'
import type { ManualSearchTarget } from './TitleDetail'
import { useTitleDownloads } from './TitleDownloads'
import { foundText } from './WantedLine'
import { useSearchVersion } from './VersionSearch'

type Version = TitleDetail['versions'][number]

/** "Wanted 12 days · last searched 2 h ago · 23 releases, none fit the Profile": why a Slot has no file yet. */
function wantedLine(v: Version, now: number): string {
  const days = v.wanted_since ? Math.floor((now - new Date(v.wanted_since).getTime()) / 86_400_000) : 0
  const ls = v.last_search
  return [days >= 1 ? `Wanted ${plural(days, 'day')}` : 'Just became Wanted', ls ? `last searched ${ago(ls.at, now)} · ${foundText(ls)}` : 'not searched yet'].join(' · ')
}

export function MovieSection({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (t: ManualSearchTarget) => void }) {
  const phone = usePhone()
  const [deleting, setDeleting] = useState<Version | null>(null)
  const versions = slotKeys.flatMap((k) => title.versions.filter((v) => v.slot === k))
  if (versions.length === 0) return null
  return (
    <section aria-label="Files" className="mt-6">
      <div className="mb-3">
        <h3 className="heading-16">Files</h3>
      </div>
      <TableRoot>
        <Table aria-label="Movie" stickyHeader>
          <TableHeader>
            <TableRow>
              {!phone && <TableHead className="w-20 px-2">Slot</TableHead>}
              <TableHead truncate className="px-2">
                {phone ? 'Slot' : 'File'}
              </TableHead>
              {!phone && <TableHead className="px-2 whitespace-nowrap">Quality</TableHead>}
              {!phone && (
                <TableHead align="right" className="px-2">
                  Size
                </TableHead>
              )}
              {!phone && <TableHead className="px-2">Imported</TableHead>}
              <TableHead align="right" className="w-17 px-2 max-sm:w-13 max-sm:px-1">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <FileRow
                key={v.id}
                title={title}
                version={v}
                onManualSearch={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}
                onDelete={() => setDeleting(v)}
              />
            ))}
          </TableBody>
        </Table>
      </TableRoot>
      {deleting && <DeleteFile versionId={deleting.id} file={deleting.file} asking onClose={() => setDeleting(null)} />}
    </section>
  )
}

/** One Slot of the Movie: its file, or why it has none. */
function FileRow({ title, version: v, onManualSearch, onDelete }: { title: TitleDetail; version: Version; onManualSearch: () => void; onDelete: () => void }) {
  const phone = usePhone()
  const now = useNow()
  const downloads = useTitleDownloads(title.id)
  const search = useSearchVersion(title, v.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const name = slotLabel[v.slot]
  const dl = downloads.slot(v.slot)
  const stateKey = dl ? 'downloading' : v.state
  const f = v.file
  const dot = dotOf(stateKey, v.long_missing && !dl)
  const state = versionStatus(stateKey).label
  const progress = cellText({ state: stateKey, score: f?.score ?? null, file: f }, { air_date: null }, dl?.items[0], state, now)
  // The first line of the File column and the line under it.
  const wanted = stateKey === 'wanted'
  const first = f ? baseName(f.path) : dl ? (progress ?? state) : wanted ? 'No file yet' : state
  const second = f ? (f.release_name ? `from ${f.release_name}` : null) : dl ? (dl.items[0]?.release_name ?? null) : wanted ? wantedLine(v, now) : null
  const quality = f?.quality ? qualityName(f.quality) : state
  const facts = f ? `${quality} · ${size(f.size)}` : quality
  const imported = f ? importedOn(f.imported_at) : ''
  const dotEl = <StatusDot state={dot.state} variant={dot.variant} label={false} title={null} aria-hidden className={dot.faint ? faintDot : undefined} />
  const tone = f ? '' : wanted ? 'text-amber-900' : dl ? 'text-blue-900' : 'text-gray-900'
  const fileLine = f ? (
    <span dir="rtl" title={f.path} className="label-12-mono block min-w-0 truncate text-left">
      <bdi>{first}</bdi>
    </span>
  ) : (
    <span className={`label-13 truncate ${tone}`}>{first}</span>
  )
  const secondLine = second && (
    <span className="label-12 truncate text-gray-900" title={second}>
      {second}
    </span>
  )
  const actions = (
    <span className={`flex items-center justify-end gap-1 max-sm:gap-0 ${rowActionsShown}`}>
      {f && (
        <FileDetailsPopover
          label={`${name} file`}
          heading={name}
          dot={dotOf('filled', false)}
          file={f}
          position="bottom-end"
          trigger={
            <Button svgOnly variant="tertiary" size="tiny" aria-label={`${name} file details`} title="File details">
              <FileVideo aria-hidden className="size-3.5" />
            </Button>
          }
        />
      )}
      {wanted && !f && <IconAction icon={Search} label={`Search for the ${name} file now`} disabled={!title.monitored || search.pending} onClick={search.run} />}
      <DotsMenu aria-label={`${name} file actions`} size="tiny" iconSize={12} onOpenChange={setMenuOpen} width={240}>
        <MenuItem onSelect={onManualSearch}>{`Manual search ${name}…`}</MenuItem>
        {f && (
          <MenuItem type="error" onSelect={onDelete}>
            {`Delete ${name} file…`}
          </MenuItem>
        )}
      </DotsMenu>
    </span>
  )
  return (
    <TableRow data-menu-open={menuOpen ? '' : undefined} className="group/row" aria-label={`${name}: ${state}`}>
      {phone ? (
        <TableCell truncate className="px-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={`label-13 flex items-center gap-1.5 ${f ? '' : tone}`}>
              <strong className="font-medium text-gray-1000">{name}</strong>
              {dotEl}
              <span className="truncate">
                {f ? facts : wanted ? `Wanted${v.wanted_since ? ` · ${Math.max(0, Math.floor((now - new Date(v.wanted_since).getTime()) / 86_400_000))} d` : ''}` : (progress ?? state)}
              </span>
            </span>
            {f ? fileLine : wanted || dl ? secondLine : null}
          </span>
        </TableCell>
      ) : (
        <>
          <TableCell className="px-2 font-medium">{name}</TableCell>
          <TableCell truncate className="px-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              {fileLine}
              {secondLine}
            </span>
          </TableCell>
          <TableCell className={`px-2 whitespace-nowrap ${wanted && !f ? 'text-amber-900' : dl ? 'text-blue-900' : ''}`}>
            <span className="flex items-center gap-1.5">
              {dotEl}
              {quality}
            </span>
          </TableCell>
          <TableCell align="right" className="px-2 text-gray-900 tabular-nums whitespace-nowrap">
            {f ? size(f.size) : '—'}
          </TableCell>
          <TableCell className="px-2 text-gray-900 whitespace-nowrap">{imported || '—'}</TableCell>
        </>
      )}
      <TableCell align="right" className="px-2 max-sm:px-1">
        {actions}
      </TableCell>
    </TableRow>
  )
}
