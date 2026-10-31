// The grid's summary of the picked Title, in a panel on the right: its poster, name, meta and state line, then for a
// Movie its Versions, when it was last searched, its actions and overview, and for a Series how much of each Version
// is there (its seasons and episodes come with hyprsh/kestrel#268). Open Title shows the whole Title page.
import { Badge, Button, Entity, Note, Skeleton } from '@hyprsh/design'
import { X } from 'lucide-react'
import { forwardRef } from 'react'
import { useProfiles, useTitle, type TitleDetail, type TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { PaneHeader } from '../layout/Pane'
import { SidePanel } from '../layout/SidePanel'
import { TitlePoster } from '../poster'
import { ago, clockTime } from '../time'
import { slotKeys, slotLabel, versionStatus } from './bits'
import { stateLine, toneText } from './rowState'
import { TitleActions } from './TitleActions'
import type { ManualSearchTarget } from './TitleDetail'
import { TitleStatus } from './TitleStatus'

type Props = {
  row: TitleRow
  grabs: readonly QueueItem[]
  now: number
  onOpen: () => void
  onClose: () => void
  onManualSearch: (target: ManualSearchTarget) => void
}

export const TitleSummary = forwardRef<HTMLElement, Props>(function TitleSummary({ row, grabs, now, onOpen, onClose, onManualSearch }, ref) {
  const { data, isError } = useTitle(row.id)
  const line = stateLine(row, grabs, now)
  return (
    <SidePanel label={`${row.title} summary`}>
      <PaneHeader>
        <span className="label-13 flex-1 text-gray-900">{row.kind === 'series' ? 'Series' : 'Movie'}</span>
        <Button variant="secondary" size="small" onClick={onOpen}>
          Open Title
        </Button>
        <Button variant="tertiary" size="small" svgOnly aria-label="Close summary" onClick={onClose}>
          <X />
        </Button>
      </PaneHeader>
      <section
        ref={ref}
        tabIndex={-1}
        aria-label={row.title}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' && e.target === e.currentTarget) {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <div className="flex gap-3.5">
          <TitlePoster id={row.id} hasPoster={row.has_poster} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="heading-20">{row.title}</h2>
            {data ? <span className="copy-13 text-gray-900">{meta(data).join(' · ')}</span> : <Skeleton width={120} height={16} />}
            <span className={`copy-13 ${toneText[line.tone]}`}>{line.text}</span>
          </div>
        </div>
        {isError ? (
          <Note variant="error" size="small">
            Could not load this Title.
          </Note>
        ) : !data ? (
          <Skeleton height={96} />
        ) : data.kind === 'movie' ? (
          <MovieSummary title={data} row={row} now={now} onManualSearch={onManualSearch} />
        ) : (
          <SeriesSummary title={data} onOpen={onOpen} />
        )}
      </section>
    </SidePanel>
  )
})

/** "2024 · 118 min · PG-13" */
function meta(t: TitleDetail): string[] {
  return [t.year ? String(t.year) : null, t.runtime ? `${t.runtime} min` : null, t.certification].filter((x): x is string => !!x)
}

/** "Last searched 14:02", "Last searched 3 d ago" or "Not searched yet". */
function lastSearched(iso: string | null, now: number): string {
  if (!iso) return 'Not searched yet'
  return now - Date.parse(iso) < 12 * 60 * 60 * 1000 ? `Last searched ${clockTime(iso)}` : `Last searched ${ago(iso, now)}`
}

function MovieSummary({ title, row, now, onManualSearch }: { title: TitleDetail; row: TitleRow; now: number; onManualSearch: (target: ManualSearchTarget) => void }) {
  const profiles = useProfiles().data ?? []
  const profileName = (key: string) => profiles.find((p) => p.key === key)?.name ?? key
  return (
    <>
      <Entity.List aria-label="Versions">
        {slotKeys.map((k) => {
          const v = title.versions.find((x) => x.slot === k)
          const s = v ? versionStatus(v.state, v.long_missing) : null
          return (
            <Entity
              key={k}
              aria-label={slotLabel[k]}
              left={<span className="label-12-mono w-14 text-gray-900">{slotLabel[k]}</span>}
              right={
                s ? (
                  <Badge variant={s.variant} contrast={s.contrast} size="sm">
                    {s.label}
                  </Badge>
                ) : undefined
              }
            >
              <Entity.Content title={<span className="label-13 font-normal text-gray-900">{v ? profileName(v.profile) : 'No Version'}</span>} />
            </Entity>
          )
        })}
      </Entity.List>
      <p className="copy-13 text-gray-900">{lastSearched(row.searched_at, now)}</p>
      <div className="-mt-4">
        <TitleActions title={title} profileName={profileName} onManualSearch={onManualSearch} />
      </div>
      {title.overview && <p className="copy-14 text-gray-900">{title.overview}</p>}
    </>
  )
}

function SeriesSummary({ title, onOpen }: { title: TitleDetail; onOpen: () => void }) {
  return (
    <>
      <div className="-mt-2">
        <TitleStatus title={title} />
      </div>
      {title.overview && <p className="copy-14 line-clamp-4 text-gray-900">{title.overview}</p>}
      <div>
        <Button variant="secondary" size="small" onClick={onOpen}>
          Show Episodes
        </Button>
      </div>
    </>
  )
}
