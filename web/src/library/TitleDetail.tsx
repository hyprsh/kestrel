import { Entity, Note, Skeleton } from '@hyprsh/design'
import { forwardRef, Fragment, type ReactNode } from 'react'
import { useProfiles, useTitle, type EpisodeScope, type TitleDetail as Detail, type TitleRow } from '../api/queries'
import { TitlePoster } from '../poster'
import { plural } from '../format'
import { sourceName } from '../requests/source'
import type { SlotKey } from './bits'
import { rated, Ratings } from './Ratings'
import { SeriesSection } from './SeriesSection'
import { MovieSection } from './MovieSection'
import { TitleHistory } from './TitleHistory'
import { MonitoringLine, MutedFrame } from './MonitorButton'
import { TitleActions } from './TitleActions'
import { TitleBadges } from './TitleBadges'
import { VersionRows } from './VersionRows'

/**
 * The right pane of the Library: the selected Title's header with its search button and menu, its Versions, and a Series' episodes under them.
 * It takes the width it is given.
 */
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
      className="min-w-0 flex-1 overflow-auto p-4 outline-none sm:px-8 sm:py-6"
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

/** What the Title page will hold, sized like it: the header (poster, name, meta) and a card of Version rows. Silent: the page announces loading itself. */
function TitleSkeleton() {
  return (
    <div className="@container">
      <div className="flex gap-5">
        <Skeleton width={88} height={132} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton width="40%" height={32} />
          <Skeleton width="25%" height={20} />
          <Skeleton width="50%" height={24} />
          <Skeleton height={60} />
        </div>
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

/** TheTVDB's status as the meta line says it: "Ended", "Continuing", "Upcoming". */
const statusWord = (status: string) => status.charAt(0).toUpperCase() + status.slice(1)

/** The Version a manual search is opened for, of a Series maybe narrowed to a season or episodes. */
export type ManualSearchTarget = { versionId: number; slot: SlotKey; profileName: string; scope?: { body: EpisodeScope; label: string; code: string | null } }

function Body({ title, onManualSearch }: { title: Detail; onManualSearch: (search: ManualSearchTarget) => void }) {
  const profiles = useProfiles()
  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  const profileName = (key: string) => names.get(key) ?? key
  const seasons = title.seasons.filter((s) => s.number > 0).length
  const meta: ReactNode[] = [
    title.year,
    title.kind === 'series' ? (seasons > 0 ? plural(seasons, 'season') : null) : runtime(title.runtime),
    title.kind === 'series' && title.series_status ? statusWord(title.series_status) : null,
    title.certification,
    rated(title.ratings) ? <Ratings ratings={title.ratings} compact /> : null,
    title.kind === 'movie' && title.original_language ? `Original ${title.original_language.toUpperCase()}` : null,
  ].filter((m) => m !== null && m !== '')

  const muted = title.kind === 'movie' && !title.monitored
  const Frame = muted ? MutedFrame : Fragment
  return (
    <div className="@container">
      <Frame>
        <div className="flex gap-5 max-sm:gap-3">
          <span data-muted={muted ? '' : undefined} className={`shrink-0 self-start ${muted ? 'opacity-70 grayscale' : ''}`}>
            <TitlePoster id={title.id} hasPoster={title.has_poster} alt={`${title.title} poster`} size="title" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className={`heading-32 min-w-0 flex-1 basis-48 max-sm:heading-24 ${muted ? 'text-gray-900' : ''}`}>{title.title}</h2>
              <TitleActions title={title} profiles={profiles.data ?? []} profileName={profileName} onManualSearch={onManualSearch} />
            </div>
            {title.primary_title !== title.title && <div className="copy-14 text-gray-900">{title.primary_title}</div>}
            <div className="label-14 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-gray-900">
              {meta.map((m, i) => (
                <span key={i}>{i < meta.length - 1 ? <>{m}&nbsp;·</> : m}</span>
              ))}
            </div>
            <MonitoringLine title={title} />
            <TitleBadges title={title} />
            {title.requests.map((r) => (
              <div key={r.id} className="copy-13 text-gray-900">
                Requested by {r.requester_name} via {sourceName(r.source)}
              </div>
            ))}
            {title.overview && <p className="copy-14 line-clamp-2 max-w-prose text-gray-900">{title.overview}</p>}
          </div>
        </div>
      </Frame>

      <VersionRows title={title} profiles={profiles.data ?? []} profileName={profileName} onManualSearch={onManualSearch} />
      {title.kind === 'series' ? <SeriesSection title={title} onManualSearch={onManualSearch} /> : <MovieSection title={title} profileName={profileName} onManualSearch={onManualSearch} />}
      <TitleHistory title={title} />
    </div>
  )
}

/** 106 minutes as "1 h 46 min". */
function runtime(minutes: number | null): string | null {
  if (!minutes) return null
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`
}
