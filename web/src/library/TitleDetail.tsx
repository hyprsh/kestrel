import { forwardRef } from 'react'
import { apiBaseUrl } from '../api/client'
import { useProfiles, useTitle, type TitleDetail as Detail, type TitleRow } from '../api/queries'
import { cx } from '../ui'
import { slotKeys, slotLabel, StatusBadge, type SlotKey } from './bits'

function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** The right pane of the Library: the selected Title's header and its SD | HD | UHD Versions strip. */
export const TitleDetail = forwardRef<HTMLElement, { row: TitleRow; onEscape: () => void }>(function TitleDetail({ row, onEscape }, ref) {
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
        <Body title={data} />
      ) : (
        <div className="text-gray-900">Loading…</div>
      )}
    </section>
  )
})

function Body({ title }: { title: Detail }) {
  const profiles = useProfiles()
  const names = new Map((profiles.data ?? []).map((p) => [p.key, p.name]))
  const meta = [
    title.year,
    title.runtime ? `${title.runtime} min` : null,
    title.certification,
    title.original_language ? `Original ${title.original_language.toUpperCase()}` : null,
  ].filter(Boolean)
  const ids = [title.tmdb_id ? `TMDB ${title.tmdb_id}` : null, title.imdb_id, title.tvdb_id ? `TVDB ${title.tvdb_id}` : null].filter(Boolean)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex gap-4">
        {title.has_poster ? (
          <img src={`${apiBaseUrl}/titles/${title.id}/poster`} alt={`${title.title} poster`} className="h-36 w-24 shrink-0 rounded-md object-cover" />
        ) : (
          <div aria-hidden className="h-36 w-24 shrink-0 rounded-md bg-gradient-to-br from-gray-200 to-gray-300" />
        )}
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">{title.title}</h2>
          {title.primary_title !== title.title && <div className="text-[15px] text-gray-900">{title.primary_title}</div>}
          <div className="mt-1 text-gray-900">{meta.join(' · ')}</div>
          <div className="mt-0.5 font-mono text-[11px] text-gray-900">{ids.join(' · ')}</div>
          {title.overview && <p className="mt-3 max-w-prose text-gray-900">{title.overview}</p>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {slotKeys.map((k) => (
          <VersionColumn key={k} slot={k} title={title} profileName={(key) => names.get(key) ?? key} />
        ))}
      </div>
    </div>
  )
}

function VersionColumn({ slot, title, profileName }: { slot: SlotKey; title: Detail; profileName: (key: string) => string }) {
  const v = title.versions.find((x) => x.slot === slot)
  return (
    <div role="group" aria-label={slotLabel[slot]} className={cx('rounded-lg border p-3', v ? 'border-gray-alpha-400' : 'border-dashed border-gray-alpha-400')}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium text-gray-900">{slotLabel[slot]}</span>
        {v && <StatusBadge state={v.state} longMissing={v.long_missing} />}
      </div>
      {v ? (
        <div className="mt-2">
          <div className="text-[13px] font-medium">{profileName(v.profile)}</div>
          {v.file ? (
            <div className="mt-1 text-[12px] text-gray-900">
              <div className="truncate font-mono text-[11px]" title={v.file.release_name}>
                {v.file.release_name}
              </div>
              <div>
                {size(v.file.size)}
                {v.file.score !== null && ` · Score ${v.file.score}`}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[12px] text-gray-900">No file yet</div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-gray-900">No Version</div>
      )}
    </div>
  )
}
