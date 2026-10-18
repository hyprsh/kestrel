// The Clean up screen: review the Unmanaged files inside tracked Titles' folders by category,
// untick what to keep, confirm, and delete permanently.
import { useState } from 'react'
import { usePreviewCleanup, useRunCleanup, type CleanupCategory, type CleanupPreview, type CleanupResult } from '../api/cleanup'
import { ApiError } from '../api/queries'
import { Button, ErrorText } from '../forms'

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
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-[15px] font-semibold tracking-tight">Clean up Unmanaged files</h1>
        <p className="mt-1 text-gray-900">
          Lists the files in your tracked Titles' folders that no Version holds. Deleting is permanent. Nothing is deleted until you confirm.
        </p>
        {failed instanceof ApiError && <ErrorText>{failed.message}</ErrorText>}
        {done && (
          <div role="status" className="mt-4 rounded-md border border-gray-alpha-400 p-3">
            Deleted {done.deleted} {done.deleted === 1 ? 'file' : 'files'} ({mb(done.bytes)})
            {done.failed > 0 && `, ${done.failed} could not be deleted`}.
          </div>
        )}
        {preview.data ? (
          <Review
            key={preview.data.preview_id}
            data={preview.data}
            busy={run.isPending}
            onRun={(categories, exclude) =>
              run.mutate({ previewId: preview.data.preview_id, categories, exclude }, { onSuccess: (r) => { setDone(r); preview.reset() } })
            }
            onCancel={() => preview.reset()}
          />
        ) : (
          <div className="mt-4">
            <Button onClick={() => { setDone(null); preview.mutate(titleIds) }} disabled={preview.isPending}>
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
  onRun,
  onCancel,
}: {
  data: CleanupPreview
  busy: boolean
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

  if (nonEmpty.length === 0) return <div className="mt-6 text-gray-900">No Unmanaged files were found.</div>
  return (
    <div className="mt-4">
      <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
        {nonEmpty.map((c) => (
          <li key={c.key} className="p-3">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={ticked.has(c.key)} onChange={() => { setConfirming(false); setTicked(toggle(ticked, c.key)) }} aria-label={labels[c.key]} />
              {labels[c.key]}
              <span className="text-[12px] font-normal text-gray-900">
                {c.count} {c.count === 1 ? 'item' : 'items'}, {mb(c.size)}
              </span>
            </label>
            <details className="mt-1 pl-6">
              <summary className="cursor-pointer text-[12px] text-gray-900">Show files</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {c.files.map((f) => (
                  <li key={f.path} className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={!skipped.has(f.path)}
                      onChange={() => { setConfirming(false); setSkipped(toggle(skipped, f.path)) }}
                      aria-label={`Delete ${baseName(f.path)}`}
                    />
                    <span className="font-mono" title={f.path}>{baseName(f.path)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {confirming ? (
          <Button onClick={() => onRun(chosen.map((c) => c.key), [...skipped])} disabled={busy}>
            Delete permanently
          </Button>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={files.length === 0}>
            Delete {files.length} {files.length === 1 ? 'item' : 'items'} ({mb(bytes)})
          </Button>
        )}
        {confirming && <span className="text-gray-900">This cannot be undone.</span>}
      </div>
    </div>
  )
}
