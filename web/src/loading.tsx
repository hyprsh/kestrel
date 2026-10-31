import { Entity, Skeleton, Spinner } from '@hyprsh/design'
import { useEffect, useState, type ReactNode } from 'react'
import { PosterSkeleton, type PosterSize } from './poster'

/** The design's advice for a Spinner: show it only after about 300ms, so a quick load does not flash it. */
const showAfterMs = 300

/** True once `on` has held for `ms`, so something shown only for a slow wait stays hidden for a quick one. */
export function useAfter(ms: number, on = true): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) {
      setLate(false)
      return
    }
    const t = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return late
}

/** Waits for typing to pause before a value is used, so a search is not sent per keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** A Spinner with text, such as "Loading…", that appears only once the wait passes about 300ms. */
export function LoadingLine({ children }: { children: string }) {
  const late = useAfter(showAfterMs)
  if (!late) return null
  return (
    <p className="label-13 flex items-center gap-2 text-gray-900">
      <Spinner size="sm" />
      {children}
    </p>
  )
}

/** The part of a TanStack query that `Loaded` reads. */
type QueryLike<T> = { isPending: boolean; isError: boolean; data: T | undefined }

/**
 * The one place that decides loading, error, empty or content for a query. While it is pending only
 * `skeleton` shows (pass a busy region, such as `SkeletonRows` or `SkeletonForm`). `empty` shows only
 * once the query has returned and `isEmpty` (by default: an empty array) holds, and `error` shows when
 * it failed (nothing when left out). `children` gets the data.
 */
export function Loaded<T>({
  query,
  skeleton,
  empty,
  isEmpty = (d) => Array.isArray(d) && d.length === 0,
  error,
  children,
}: {
  query: QueryLike<T>
  skeleton: ReactNode
  empty?: ReactNode
  isEmpty?: (data: T) => boolean
  error?: ReactNode
  children: (data: T) => ReactNode
}) {
  if (query.isPending) return <>{skeleton}</>
  if (query.data === undefined) return query.isError ? <>{error}</> : null
  if (empty !== undefined && isEmpty(query.data)) return <>{empty}</>
  return <>{children(query.data)}</>
}

/** A busy region: its Skeleton shapes are decorative, so one hidden status says that it is loading. */
export function LoadingRegion({ children, label = 'Loading' }: { children: ReactNode; label?: string }) {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  )
}

/** One Entity row of Skeleton blocks: an optional poster, a title line and a description line. `index` varies the widths. */
export function SkeletonRow({ index = 0, poster, description = true }: { index?: number; poster?: PosterSize | 'icon'; description?: boolean }) {
  return (
    <Entity aria-hidden left={poster === 'icon' ? <Skeleton width={16} height={16} /> : poster ? <PosterSkeleton size={poster} /> : undefined}>
      <Entity.Content
        fill
        title={<Skeleton width={`${50 + ((index * 17) % 30)}%`} height={16} />}
        description={description ? <Skeleton width={`${30 + ((index * 13) % 25)}%`} height={14} /> : undefined}
      />
    </Entity>
  )
}

/**
 * `count` Skeleton rows in a list of their own, in the place of a section's rows. The list is `aria-busy`.
 * Under a heading that names what is loading, that is all it needs. Where no heading does, pass `label`
 * for the hidden status its siblings (`LoadingRegion`, `SkeletonForm`) announce.
 */
export function SkeletonRows({ count = 3, label, ...row }: { count?: number; label?: string; poster?: PosterSize | 'icon'; description?: boolean }) {
  return (
    <div aria-busy="true">
      {label && (
        <span role="status" className="sr-only">
          {label}
        </span>
      )}
      <Entity.List className="@container">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonRow key={i} index={i} {...row} />
        ))}
      </Entity.List>
    </div>
  )
}

/** Rows of a label and a control, the shape of a Settings section while its settings load. */
export function SkeletonForm({ rows = 2 }: { rows?: number }) {
  return (
    <LoadingRegion>
      <div aria-hidden className="flex max-w-md flex-col gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton width={`${35 + ((i * 11) % 20)}%`} height={14} />
            <Skeleton height={32} />
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

/** A neutral full-page frame for app start, before Kestrel knows who is signed in or whether setup is done: a rail and a few rows. */
export function PageSkeleton() {
  return (
    <LoadingRegion>
      <div aria-hidden className="flex h-dvh">
        <div className="hidden w-56 shrink-0 flex-col gap-3 p-4 sm:flex">
          <Skeleton width={96} height={20} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={16} width={`${60 + ((i * 11) % 30)}%`} />
          ))}
        </div>
        <div className="min-w-0 flex-1 p-6 max-sm:p-4">
          <SkeletonRows count={6} poster="md" />
        </div>
      </div>
    </LoadingRegion>
  )
}
