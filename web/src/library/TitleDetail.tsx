import { forwardRef, useRef } from 'react'
import { useProfiles, useTitle, type EpisodeScope, type TitleDetail as Detail, type TitleRow } from '../api/queries'
import { TitlePoster } from '../poster'
import { slotKeys, type SlotKey } from './bits'
import { ExternalIds } from './ExternalIds'
import { Ratings } from './Ratings'
import { SeriesSection } from './SeriesSection'
import { SlotCard } from './SlotCard'
import { TitleActions } from './TitleActions'
import { TitleDownloads } from './TitleDownloads'

/** The right pane of the Library: the selected Title's header, its actions row and its Standard | 4K Slot cards. */
export const TitleDetail = forwardRef<HTMLElement, { row: TitleRow; onEscape: () => void; onManualSearch: (search: ManualSearchTarget) => void }>(function TitleDetail(
  { row, onEscape, onManualSearch },
  ref,
) {
  const { data, isError } = useTitle(row.id)
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={row.title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onEscape()
        }
      }}
      className="min-w-0 flex-1 overflow-auto p-6 outline-none"
    >
      {isError ? (
        <p role="alert" className="text-[12px] text-red-900">
          Could not load this Title.
        </p>
      ) : data ? (
        <Body title={data} onManualSearch={onManualSearch} />
      ) : (
        <div className="text-gray-900">Loading…</div>
      )}
    </section>
  )
})

/** The Version a manual search is opened for, of a Series maybe narrowed to a season or episodes. */
export type ManualSearchTarget = { versionId: number; slot: SlotKey; profileName: string; scope?: { body: EpisodeScope; label: string } }

function Body({ title, onManualSearch }: { title: Detail; onManualSearch: (search: ManualSearchTarget) => void }) {
  const profiles = useProfiles()
  const episodes = useRef<HTMLDivElement>(null)
  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  const profileName = (key: string) => names.get(key) ?? key
  const meta = [
    title.year,
    title.runtime ? `${title.runtime} min` : null,
    title.certification,
    title.original_language ? `Original ${title.original_language.toUpperCase()}` : null,
  ].filter(Boolean)

  return (
    <div className="@container mx-auto max-w-3xl">
      <div className="flex gap-4">
        <TitlePoster id={title.id} hasPoster={title.has_poster} alt={`${title.title} poster`} className="h-36 w-24 rounded-md" />
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">{title.title}</h2>
          {title.primary_title !== title.title && <div className="text-[15px] text-gray-900">{title.primary_title}</div>}
          <div className="mt-1 text-gray-900">{meta.join(' · ')}<Ratings ratings={title.ratings} lead={meta.length > 0} /></div>
          <ExternalIds title={title} />
          {title.requests.map((r) => (
            <div key={r.id} className="mt-1 text-[13px] text-gray-900">
              Requested by {r.requester_name} via {r.source}
            </div>
          ))}
          {title.overview && <p className="mt-3 max-w-prose text-gray-900">{title.overview}</p>}
        </div>
      </div>
      <TitleActions title={title} profileName={profileName} onManualSearch={onManualSearch} />
      <TitleDownloads titleId={title.id} />

      {/* Side by side only when the pane, not the window, has room for both cards' buttons. */}
      <div className="mt-6 grid grid-cols-1 gap-3 @xl:grid-cols-2">
        {slotKeys.map((k) => (
          <SlotCard
            key={k}
            slot={k}
            title={title}
            profiles={profiles.data ?? []}
            profileName={profileName}
            onCoverage={() => episodes.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
          />
        ))}
      </div>

      {title.kind === 'series' && (
        <div ref={episodes} className="scroll-mt-4">
          <SeriesSection title={title} onManualSearch={onManualSearch} />
        </div>
      )}
    </div>
  )
}
