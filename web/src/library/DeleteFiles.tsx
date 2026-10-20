// Delete files and keep the Version (#130): a Movie's file on the Title page,
// an episode's, a season's or the ticked episodes' files in the episode grid.
// Every deletion asks first, naming the files, their total size and every
// episode that loses its file, those sharing a file with the chosen ones too.
import { useState } from 'react'
import type { Episode } from '../api/queries'
import type { components } from '../api/schema.gen'
import { useDeleteFiles, type DeletedFiles, type FilesScope } from '../api/versions'
import { Button, ErrorText } from '../forms'
import { MenuItem } from '../menu'
import { size, slotLabel, type SlotKey } from './bits'

type FileSummary = components['schemas']['FileSummary']
type EpisodeFile = components['schemas']['EpisodeFile']
type Version = { id: number; slot: SlotKey }
type Status = { text: string; error: boolean } | null

const two = (n: number) => String(n).padStart(2, '0')
const code = (e: Episode) => `S${two(e.season)}E${two(e.number)}`
const base = (path: string) => path.split(/[\\/]/).pop() ?? path
const files = (n: number) => (n === 1 ? '1 file' : `${n} files`)

/** What a deletion did, for the status line: the files, and those whose Release was not blocklisted. */
function deletedText(res: DeletedFiles, blocklist: boolean, label?: string) {
  const kept = res.not_deleted.map((f) => `Could not delete ${base(f.path)}: ${f.reason}.`).join(' ')
  if (res.files.length === 0) return kept || `Nothing to delete${label ? ` in ${label}` : ''}.`
  let text = `Deleted ${files(res.files.length)}${label ? ` of ${label}` : ''}.`
  const missed = res.files.filter((f) => !f.blocklisted).length
  if (blocklist && missed > 0) text += ` ${files(missed)} not blocklisted: Kestrel did not grab or could not blocklist ${missed === 1 ? 'it' : 'them'}.`
  return kept ? `${text} ${kept}` : text
}

/**
 * The confirmation of a deletion: the files with their total size, the
 * episodes that lose their file (`extra` are those outside the choice that
 * share a file with it), and Delete or Delete and blocklist.
 */
export function DeleteFilesConfirm({
  paths,
  bytes,
  episodes = [],
  extra = [],
  onConfirm,
  onCancel,
  error,
  busy,
}: {
  paths: string[]
  bytes: number
  episodes?: string[]
  extra?: string[]
  onConfirm: (blocklist: boolean) => void
  onCancel: () => void
  error?: string
  busy: boolean
}) {
  const releases = paths.length === 1 ? 'this Release' : 'these Releases'
  return (
    <div role="group" aria-label="Delete files" className="mt-2 rounded-md border border-gray-alpha-400 p-2 text-[12px]">
      <p>
        Delete {files(paths.length)}, {size(bytes)}, from disk? The Version stays; while monitored it is Wanted again.
      </p>
      <ul className="mt-1">
        {paths.map((p) => (
          <li key={p} className="truncate font-mono text-[11px]" title={p}>
            {base(p)}
          </li>
        ))}
      </ul>
      {episodes.length > 0 && <p className="mt-1">Loses its file: {episodes.join(', ')}</p>}
      {extra.length > 0 && (
        <p className="mt-1 text-amber-900">
          {extra.join(', ')} {extra.length === 1 ? 'shares' : 'share'} a file with {episodes.length - extra.length === 1 ? 'it' : 'them'} and {extra.length === 1 ? 'loses its file' : 'lose their files'} too.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="danger" className="h-7" disabled={busy} onClick={() => onConfirm(false)}>
          Delete
        </Button>
        <Button variant="danger" className="h-7" disabled={busy} onClick={() => onConfirm(true)}>
          Delete and blocklist {releases}
        </Button>
        <Button variant="secondary" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A Movie Version's Delete file: the Version stays, Wanted again while the Movie is monitored. */
export function DeleteFile({ versionId, file }: { versionId: number; file: FileSummary | null }) {
  const del = useDeleteFiles()
  const [asking, setAsking] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  if (!file && !said) return null
  const confirm = (blocklist: boolean) =>
    del.mutate(
      { versionId, blocklist },
      {
        onSuccess: (res) => {
          setAsking(false)
          setSaid(deletedText(res, blocklist))
        },
      },
    )
  return (
    <div>
      {file && !asking && (
        <Button variant="secondary" className="h-7 w-full" onClick={() => setAsking(true)}>
          Delete file
        </Button>
      )}
      {file && asking && (
        <DeleteFilesConfirm
          paths={[file.path]}
          bytes={file.size}
          onConfirm={confirm}
          onCancel={() => setAsking(false)}
          error={del.error?.message}
          busy={del.isPending}
        />
      )}
      {said && (
        <p role="status" className="mt-1 text-[12px] text-gray-900">
          {said}
        </p>
      )}
    </div>
  )
}

/** A deletion in the episode grid waiting for its confirmation. */
type Plan = { version: Version; label: string; scope: FilesScope; files: EpisodeFile[]; episodes: string[]; extra: string[] }

export type EpisodeDeletes = {
  /** Whether a Version holds a file for any of `eps`. */
  has: (v: Version, eps: Episode[]) => boolean
  /** Asks to delete the files of `v` holding `eps`, sent with `scope` and named `label`. */
  ask: (v: Version, eps: Episode[], label: string, scope: FilesScope) => void
  pending: Plan | null
  confirm: (blocklist: boolean) => void
  cancel: () => void
  error?: string
  busy: boolean
}

const filesOf = (v: Version, eps: Episode[]) => {
  const out = new Map<number, EpisodeFile>()
  for (const e of eps) {
    const f = e.cells[v.slot]?.file
    if (f) out.set(f.id, f)
  }
  return [...out.values()]
}

/** The episode grid's deletions: one waits for its confirmation at a time; `say` reports what came of it. */
export function useEpisodeDeletes(episodes: Episode[], say: (s: Status) => void): EpisodeDeletes {
  const del = useDeleteFiles()
  const [pending, setPending] = useState<Plan | null>(null)

  const ask: EpisodeDeletes['ask'] = (version, eps, label, scope) => {
    const fs = filesOf(version, eps)
    if (fs.length === 0) return
    const chosen = new Set(eps.map((e) => e.id))
    const losing = new Set(fs.flatMap((f) => f.episode_ids))
    const lost = episodes.filter((e) => losing.has(e.id))
    del.reset()
    setPending({
      version,
      label,
      scope,
      files: fs,
      episodes: lost.map(code),
      extra: lost.filter((e) => !chosen.has(e.id)).map(code),
    })
  }

  const confirm = (blocklist: boolean) => {
    if (!pending) return
    const { version, scope, label } = pending
    del.mutate(
      { versionId: version.id, scope, blocklist },
      {
        onSuccess: (res) => {
          setPending(null)
          say({ text: deletedText(res, blocklist, label), error: res.not_deleted.length > 0 })
        },
      },
    )
  }

  return {
    has: (v, eps) => filesOf(v, eps).length > 0,
    ask,
    pending,
    confirm,
    cancel: () => setPending(null),
    error: del.error?.message,
    busy: del.isPending,
  }
}

/** The menu items deleting the files of `episodes`, one per Slot when the Series has both. */
export function DeleteMenuItems({
  deletes,
  versions,
  episodes,
  label,
  scope,
  text,
}: {
  deletes: EpisodeDeletes
  versions: Version[]
  episodes: Episode[]
  label: string
  scope: FilesScope
  text: string
}) {
  return versions.map((v) => {
    const has = deletes.has(v, episodes)
    return (
      <MenuItem key={`delete-${v.slot}`} disabled={!has} hint={has ? undefined : 'No file to delete'} onSelect={() => deletes.ask(v, episodes, label, scope)}>
        {versions.length > 1 ? `${text} ${slotLabel[v.slot]}` : text}
      </MenuItem>
    )
  })
}

/** The selection bar's Delete files, one per Slot when the Series has both. */
export function DeleteTickedButtons({ deletes, versions, ticked, label }: { deletes: EpisodeDeletes; versions: Version[]; ticked: Episode[]; label: string }) {
  return versions.map((v) => {
    const has = deletes.has(v, ticked)
    return (
      <Button
        key={v.slot}
        variant="secondary"
        className="h-6 px-2 text-[12px]"
        disabled={!has}
        title={has ? undefined : 'No file to delete'}
        onClick={() => deletes.ask(v, ticked, label, { episode_ids: ticked.map((e) => e.id) })}
      >
        {versions.length > 1 ? `Delete files ${slotLabel[v.slot]}` : 'Delete files'}
      </Button>
    )
  })
}

/** The waiting deletion's confirmation, above the episode grid. */
export function EpisodeDeleteConfirm({ deletes }: { deletes: EpisodeDeletes }) {
  const p = deletes.pending
  if (!p) return null
  return (
    <DeleteFilesConfirm
      paths={p.files.map((f) => f.path)}
      bytes={p.files.reduce((n, f) => n + f.size, 0)}
      episodes={p.episodes}
      extra={p.extra}
      onConfirm={deletes.confirm}
      onCancel={deletes.cancel}
      error={deletes.error}
      busy={deletes.busy}
    />
  )
}
