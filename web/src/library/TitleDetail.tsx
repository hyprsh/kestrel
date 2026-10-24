import { Entity, Note, Skeleton } from '@hyprsh/design'
import { forwardRef, useRef } from 'react'
import { useProfiles, useTitle, type EpisodeScope, type TitleDetail as Detail, type TitleRow } from '../api/queries'
import { TitlePoster } from '../poster'
import { sourceName } from '../requests/source'
import type { SlotKey } from './bits'
import { ExternalIds } from './ExternalIds'
import { Ratings } from './Ratings'
import { SeriesSection } from './SeriesSection'
import { TitleActions } from './TitleActions'
import { TitleDownloads } from './TitleDownloads'
import { TitleStatus } from './TitleStatus'
import { VersionRows } from './VersionRows'

/** The right pane of the Library: the selected Title's header, its status line, its actions row and its Version rows. */
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
      className="min-w-0 flex-1 overflow-auto p-6 outline-none max-sm:p-4"
    >
      {isError ? (
        <Note variant="error" size="small">
          Could not load this Title.
        </Note>
      ) : data ? (
        <Body title={data} onManualSearch={onManualSearch} />
      ) : (
        <>
          <p role="status" className="sr-only">
            Loading
          </p>
          <TitleSkeleton />
        </>
      )}
    </section>
  )
})

/** What the Title page will hold, sized like it: the header (poster, name, meta, status), the actions row and a card of Version rows. Silent: the page announces loading itself. */
function TitleSkeleton() {
  return (
    <div className="@container mx-auto max-w-3xl">
      <div className="flex gap-4">
        <Skeleton width={96} height={144} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton width="40%" height={32} />
          <Skeleton width="25%" height={20} />
          <Skeleton width="50%" height={24} />
          <Skeleton height={60} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton width={96} height={32} />
        <Skeleton width={120} height={32} />
        <Skeleton width={120} height={32} />
      </div>
      <div className="mt-6">
        <Skeleton width={64} height={20} />
        <div className="mt-2">
          <Entity.List aria-hidden>
            {[0, 1].map((i) => (
              <Entity key={i} left={<Skeleton width={56} height={16} />}>
                <Entity.Content title={<Skeleton width={140} height={16} />} description={<Skeleton width={220} height={16} />} />
              </Entity>
            ))}
          </Entity.List>
        </div>
      </div>
    </div>
  )
}

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
        <TitlePoster id={title.id} hasPoster={title.has_poster} alt={`${title.title} poster`} size="xl" />
        <div className="min-w-0">
          <h2 className="heading-24">{title.title}</h2>
          {title.primary_title !== title.title && <div className="copy-14 text-gray-900">{title.primary_title}</div>}
          <div className="copy-14 mt-1 text-gray-900">{meta.join(' · ')}<Ratings ratings={title.ratings} lead={meta.length > 0} /></div>
          <TitleStatus title={title} />
          <ExternalIds title={title} />
          {title.requests.map((r) => (
            <div key={r.id} className="copy-13 mt-1 text-gray-900">
              Requested by {r.requester_name} via {sourceName(r.source)}
            </div>
          ))}
          {title.overview && <p className="copy-14 mt-3 max-w-prose text-gray-900">{title.overview}</p>}
        </div>
      </div>
      <TitleActions title={title} profileName={profileName} onManualSearch={onManualSearch} />
      <TitleDownloads titleId={title.id} />

      <VersionRows
        title={title}
        profiles={profiles.data ?? []}
        profileName={profileName}
        onCoverage={() => episodes.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
      />

      {title.kind === 'series' && (
        <div ref={episodes} className="scroll-mt-4">
          <SeriesSection title={title} onManualSearch={onManualSearch} />
        </div>
      )}
    </div>
  )
}
