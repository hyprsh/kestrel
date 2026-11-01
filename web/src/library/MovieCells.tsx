// The Movie Title page's Slot cells: one per Slot the Movie has a Version in, as the episode table's cells read, in place of the status badges.
import { useNow } from '../time'
import type { TitleDetail } from '../api/queries'
import { dotOf, slotLabel, versionStatus } from './bits'
import { cellText } from './cellDetail'
import { FileDetailsPopover, cellTitle } from './EpisodeFilePopover'
import { SlotCell } from './SlotCell'
import { useTitleDownloads } from './TitleDownloads'

export function MovieCells({ title }: { title: TitleDetail }) {
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  if (title.versions.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {title.versions.map((v) => {
        const name = slotLabel[v.slot]
        const dl = downloads.slot(v.slot)
        const stateKey = dl ? 'downloading' : v.state
        const cell = { state: stateKey, score: v.file?.score ?? null, file: v.file }
        const state = versionStatus(stateKey).label
        const text = cellText(cell, { air_date: v.wanted_since ? v.wanted_since.slice(0, 10) : null }, dl?.items[0], state, now)
        const f = v.file
        // The tooltip repeats the line when it adds to the state, as the episode cell's does.
        const tip = cellTitle(name, state, cell) + (!f && text && text !== state ? `\n${text}` : '')
        return (
          <SlotCell
            key={v.id}
            state={stateKey}
            dot={dotOf(stateKey, v.long_missing && !dl)}
            text={text}
            title={tip}
            ariaLabel={`${name}: ${state}${text && text !== state && !text.startsWith(state) ? `, ${text}` : ''}`}
            popoverLabel={name}
            textOnPhone
            filePopover={f ? (trigger) => <FileDetailsPopover label={`${name} file`} heading={name} dot={dotOf('filled', false)} file={f} trigger={trigger} position="bottom-start" /> : undefined}
          />
        )
      })}
    </div>
  )
}
