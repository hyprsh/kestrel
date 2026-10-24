// chrome: pending
// The Clean up screen: review the Unmanaged files inside tracked Titles' folders by category,
// untick what to keep, confirm, and delete permanently.
import { useState } from 'react'
import { usePreviewCleanup, useRunCleanup, type CleanupCategory, type CleanupPreview, type CleanupResult } from '../api/cleanup'
import { ApiError } from '../api/queries'
import { Button, Checkbox, Code, Collapse, DestructiveActionModal, EmptyState, Note, Spinner } from '@hyprsh/design'

const labels: Record<CleanupCategory['key'], string> = {
  junk: 'Junk (.nfo, .sfv, .txt, .url, .exe, Thumbs.db, .DS_Store)',
  samples: 'Samples',
  orphaned_subtitles: 'Orphaned subtitles',
  empty_folders: 'Empty folders',
  other_language_subtitles: 'Subtitles in other languages',
  artwork: 'Local artwork',
  extras: 'Extras',
  unmanaged_videos: 'Unmanaged videos',
}

const mb = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${(n / (1 << 20)).toFixed(1)} MB`)
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** titleIds narrows the look to those Titles; without them every tracked Title is looked at. */
export function Cleanup({ titleIds }: { titleIds?: number[] }) {
  const preview = usePreviewCleanup()
  const run = useRunCleanup()
  const [done, setDone] = useState<CleanupResult | null>(null)
  const failed = preview.error ?? run.error

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl p-6 max-sm:p-4">
        <h1 className="heading-16">Clean up Unmanaged files</h1>
        <p className="copy-14 mt-1 text-gray-900">
          Lists the files in your tracked Titles' folders that no Version holds. Deleting is permanent. Nothing is deleted until you confirm.
        </p>
        {failed instanceof ApiError && (
          <Note variant="error" size="small" className="mt-2">
            {failed.message}
          </Note>
        )}
        {done && (
          <Note role="status" className="mt-4" variant={done.failed > 0 ? 'warning' : 'success'}>
            {`Deleted ${done.deleted} ${done.deleted === 1 ? 'file' : 'files'} (${mb(done.bytes)})${done.failed > 0 ? `, ${done.failed} could not be deleted` : ''}.`}
          </Note>
        )}
        {preview.data ? (
          <Review
            key={preview.data.preview_id}
            data={preview.data}
            busy={run.isPending}
            error={run.error instanceof ApiError ? run.error.message : null}
            onRun={(categories, exclude) =>
              run.mutate({ previewId: preview.data.preview_id, categories, exclude }, { onSuccess: (r) => { setDone(r); preview.reset() } })
            }
            onCancel={() => preview.reset()}
          />
        ) : (
          <div className="mt-4">
            <Button
              variant="primary"
              size="small"
              className="max-sm:w-full"
              prefix={preview.isPending ? <Spinner size="sm" /> : undefined}
              onClick={() => { setDone(null); preview.mutate(titleIds) }}
              disabled={preview.isPending}
            >
              Look for Unmanaged files
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Review({
  data,
  busy,
  error,
  onRun,
  onCancel,
}: {
  data: CleanupPreview
  busy: boolean
  error: string | null
  onRun: (categories: CleanupCategory['key'][], exclude: string[]) => void
  onCancel: () => void
}) {
  const [ticked, setTicked] = useState(() => new Set(data.categories.filter((c) => c.default_ticked).map((c) => c.key)))
  const [skipped, setSkipped] = useState(() => new Set<string>())
  const [confirming, setConfirming] = useState(false)
  const toggle = <T,>(s: Set<T>, v: T) => {
    const n = new Set(s)
    if (!n.delete(v)) n.add(v)
    return n
  }
  const chosen = data.categories.filter((c) => ticked.has(c.key))
  const files = chosen.flatMap((c) => c.files.filter((f) => !skipped.has(f.path)))
  const bytes = files.reduce((n, f) => n + f.size, 0)
  const nonEmpty = data.categories.filter((c) => c.count > 0)

  if (nonEmpty.length === 0) return <EmptyState className="mt-6" title="No Unmanaged Files" description="No Unmanaged files were found." />
  return (
    <div className="mt-4">
      <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
        {nonEmpty.map((c) => (
          <li key={c.key} className="p-3">
            <div className="flex flex-wrap items-center gap-x-2">
              <Checkbox checked={ticked.has(c.key)} onChange={() => setTicked(toggle(ticked, c.key))} aria-label={labels[c.key]}>
                <span className="label-14">{labels[c.key]}</span>
              </Checkbox>
              <span className="copy-13 text-gray-900">
                {c.count} {c.count === 1 ? 'item' : 'items'}, {mb(c.size)}
              </span>
            </div>
            <Collapse variant="inline" title="Show files" className="mt-1 pl-6 max-sm:pl-0">
              <ul className="mt-1 flex flex-col gap-1">
                {c.files.map((f) => (
                  <li key={f.path} className="copy-13 flex min-w-0 items-center gap-2">
                    <Checkbox checked={!skipped.has(f.path)} onChange={() => setSkipped(toggle(skipped, f.path))} aria-label={`Delete ${baseName(f.path)}`} />
                    <Code title={f.path} className="min-w-0 break-all">{baseName(f.path)}</Code>
                  </li>
                ))}
              </ul>
            </Collapse>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
        <Button size="small" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="error" size="small" onClick={() => setConfirming(true)} disabled={files.length === 0}>
          Delete {files.length} {files.length === 1 ? 'item' : 'items'} ({mb(bytes)})
        </Button>
      </div>
      <DestructiveActionModal
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => onRun(chosen.map((c) => c.key), [...skipped])}
        title="Delete Files"
        description={`Delete ${files.length} ${files.length === 1 ? 'item' : 'items'} (${mb(bytes)}) from your tracked Titles' folders.`}
        irreversibleDescription="Deleting these files is permanent and cannot be undone."
        confirmLabel="Delete Files"
        loading={busy}
        error={error}
      />
    </div>
  )
}
