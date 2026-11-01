// What a Movie adds to its Title page, below its Versions: the Files table, built as the episode table is: one card, the same
// heads (Name, Released, a column per Slot) and one row, the Movie, with a Slot cell per Version and its row actions on hover.
import { DotsMenu, MenuItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from '@hyprsh/design'
import { Search } from 'lucide-react'
import { useState } from 'react'
import type { TitleDetail } from '../api/queries'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { dotOf, slotKeys, slotLabel, versionStatus } from './bits'
import { cellText } from './cellDetail'
import { DeleteFile } from './DeleteFiles'
import { FileDetailsPopover, cellTitle } from './EpisodeFilePopover'
import { IconAction, rowActionsShown } from './IconAction'
import { SlotCell } from './SlotCell'
import type { ManualSearchTarget } from './TitleDetail'
import { useTitleDownloads } from './TitleDownloads'
import { useSearchWanted } from './VersionSearch'

type Version = TitleDetail['versions'][number]

/** The day the Movie first came out anywhere TMDB dates it ("2014-11-24"), else its year, else null. */
function releasedOf(title: TitleDetail): string | null {
  const dates = title.release_dates.map((r) => r.date).sort()
  return dates.length > 0 ? dates[0].slice(0, 10) : title.year ? String(title.year) : null
}

export function MovieSection({ title, profileName, onManualSearch }: { title: TitleDetail; profileName: (key: string) => string; onManualSearch: (t: ManualSearchTarget) => void }) {
  const phone = usePhone()
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const search = useSearchWanted(title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState<Version | null>(null)
  const versions = slotKeys.flatMap((k) => title.versions.filter((v) => v.slot === k))
  if (versions.length === 0) return null
  const released = releasedOf(title)
  const original = title.primary_title !== title.title ? title.primary_title : title.original_title !== title.title ? title.original_title : null
  const withFiles = versions.filter((v) => v.file)
  return (
    <section aria-label="Files" className="mt-6">
      <div className="mb-3">
        <h3 className="heading-16">Files</h3>
      </div>
      <TableRoot>
        <Table aria-label="Movie" stickyHeader>
          <TableHeader>
            <TableRow>
              <TableHead columnKey="name" truncate={phone} width={360} minWidth={phone ? 120 : 180} className="px-2">
                Name
              </TableHead>
              {!phone && <TableHead truncate aria-hidden className="px-0" />}
              <TableHead className="px-2 max-sm:hidden">Released</TableHead>
              {versions.map((v) => (
                <TableHead key={v.id} className="px-2 whitespace-nowrap">
                  {slotLabel[v.slot]}
                </TableHead>
              ))}
              <TableHead align="right" className="w-17 px-2 max-sm:w-13 max-sm:px-1">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow data-menu-open={menuOpen ? '' : undefined} className="group/row">
              <TableCell truncate={phone} className="px-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{title.title}</span>
                  {original && <span className="label-12 truncate text-gray-900">{original}</span>}
                </span>
              </TableCell>
              {!phone && <TableCell aria-hidden className="px-0" />}
              <TableCell className="px-2 text-gray-900 max-sm:hidden">{released ?? '—'}</TableCell>
              {versions.map((v) => {
                const name = slotLabel[v.slot]
                const dl = downloads.slot(v.slot)
                const stateKey = dl ? 'downloading' : v.state
                const f = v.file
                const cell = { state: stateKey, score: f?.score ?? null, file: f }
                const state = versionStatus(stateKey).label
                const text = cellText(cell, { air_date: v.wanted_since ? v.wanted_since.slice(0, 10) : null }, dl?.items[0], state, now)
                // The tooltip repeats the line when it adds to the state, as the episode cell's does.
                const tip = cellTitle(name, state, cell) + (!f && text && text !== state ? `\n${text}` : '')
                return (
                  <TableCell key={v.id} className="px-2">
                    <SlotCell
                      state={stateKey}
                      dot={dotOf(stateKey, v.long_missing && !dl)}
                      text={text}
                      title={tip}
                      ariaLabel={`${name}: ${state}${text && text !== state && !text.startsWith(state) ? `, ${text}` : ''}`}
                      popoverLabel={name}
                      textOnPhone
                      filePopover={
                        f ? (trigger) => <FileDetailsPopover label={`${name} file`} heading={name} dot={dotOf('filled', false)} file={f} trigger={trigger} position="bottom-start" /> : undefined
                      }
                    />
                  </TableCell>
                )
              })}
              <TableCell align="right" className="px-2 max-sm:px-1">
                <span className={`flex items-center justify-end gap-1 max-sm:gap-0 ${rowActionsShown}`}>
                  <IconAction icon={Search} label={`Search ${title.title}`} disabled={!title.monitored || search.wanted.length === 0} onClick={() => search.run()} />
                  <DotsMenu aria-label={`Actions for ${title.title}`} size="tiny" iconSize={12} onOpenChange={setMenuOpen} width={240}>
                    {versions.map((v) => (
                      <MenuItem key={`m${v.id}`} onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>
                        {`Manual search ${slotLabel[v.slot]}…`}
                      </MenuItem>
                    ))}
                    {withFiles.map((v) => (
                      <MenuItem key={`d${v.id}`} type="error" onSelect={() => setDeleting(v)}>
                        {`Delete ${slotLabel[v.slot]} file…`}
                      </MenuItem>
                    ))}
                  </DotsMenu>
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableRoot>
      {deleting && <DeleteFile versionId={deleting.id} file={deleting.file} asking onClose={() => setDeleting(null)} />}
    </section>
  )
}
