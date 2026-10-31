// Delete files and keep the Version (#130): a Movie's file on the Title page,
// an episode's, a season's or the ticked episodes' files in the episode grid.
// Every deletion asks first, naming the files, their total size and every
// episode that loses its file, those sharing a file with the chosen ones too.
import { Button, Menu, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalSubtitle, ModalTitle, Note } from '@hyprsh/design'
import { useState } from 'react'
import type { Episode, EpisodeScope } from '../api/queries'
import type { components } from '../api/schema.gen'
import { useDeleteFiles, type DeletedFiles } from '../api/versions'
import { size, slotLabel } from './bits'
import { useReport, type Report } from '../toasts'
import { episodeCode, type EpisodeVersion } from './episodes'

type FileSummary = components['schemas']['FileSummary']
type EpisodeFile = components['schemas']['EpisodeFile']
export const base = (path: string) => path.split(/[\\/]/).pop() ?? path
const files = (n: number) => (n === 1 ? '1 file' : `${n} files`)

/** What a deletion did, for its Toast: the files, and those whose Release was not blocklisted. */
function deletedText(res: DeletedFiles, blocklist: boolean, label?: string) {
  const kept = res.not_deleted.map((f) => `Could not delete ${base(f.path)}: ${f.reason}.`).join(' ')
  if (res.files.length === 0) return kept || `Nothing to delete${label ? ` in ${label}` : ''}.`
  let text = `Deleted ${files(res.files.length)}${label ? ` of ${label}` : ''}.`
  const missed = res.files.filter((f) => !f.blocklisted).length
  if (blocklist && missed > 0) text += ` ${files(missed)} not blocklisted: Kestrel did not grab or could not blocklist ${missed === 1 ? 'it' : 'them'}.`
  return kept ? `${text} ${kept}` : text
}

/** How a deletion reports: what was deleted, a warning when some files stayed, and a Toast for a failure. */
const deletion = (blocklist: boolean, label?: string): Report<DeletedFiles> => ({
  done: (res) => deletedText(res, blocklist, label),
  warn: (res) => res.not_deleted.length > 0,
  failed: 'Could not delete the files',
})

/**
 * The confirmation of a deletion: the files with their total size, the
 * episodes that lose their file (`extra` are those outside the choice that
 * share a file with it), and Delete or Delete and blocklist. An inline Modal:
 * it opens in place, takes the focus, Escape cancels, and the focus goes back
 * where it was when it closes.
 */
function DeleteFilesConfirm({
  paths,
  bytes,
  episodes = [],
  extra = [],
  onConfirm,
  onCancel,
}: {
  paths: string[]
  bytes: number
  episodes?: string[]
  extra?: string[]
  onConfirm: (blocklist: boolean) => void
  onCancel: () => void
}) {
  const releases = paths.length === 1 ? 'this Release' : 'these Releases'
  return (
    <Modal inline open onClose={onCancel}>
      <ModalBody>
        <ModalHeader>
          <ModalTitle>Delete files</ModalTitle>
          <ModalSubtitle>
            Delete {files(paths.length)}, {size(bytes)}, from disk? The Version stays; while monitored it is Wanted again.
          </ModalSubtitle>
        </ModalHeader>
        <ul className="label-12">
          {paths.map((p) => (
            <li key={p} className="label-12-mono truncate" title={p}>
              {base(p)}
            </li>
          ))}
        </ul>
        {episodes.length > 0 && <p className="label-12 mt-1">Loses its file: {episodes.join(', ')}</p>}
        {extra.length > 0 && (
          <div className="mt-2">
            <Note variant="warning" size="small">
              {extra.join(', ')} {extra.length === 1 ? 'shares' : 'share'} a file with {episodes.length - extra.length === 1 ? 'it' : 'them'} and{' '}
              {extra.length === 1 ? 'loses its file' : 'lose their files'} too.
            </Note>
          </div>
        )}
      </ModalBody>
      <ModalActions>
        <ModalAction variant="secondary" onClick={onCancel}>
          Cancel
        </ModalAction>
        <ModalAction variant="error" onClick={() => onConfirm(false)}>
          Delete
        </ModalAction>
        <ModalAction variant="error" onClick={() => onConfirm(true)}>
          Delete and blocklist {releases}
        </ModalAction>
      </ModalActions>
    </Modal>
  )
}

/**
 * A Movie Version's Delete file: the Version stays, Wanted again while the Movie is monitored. The
 * Version row's "…" menu asks for it (`asking`); this shows the confirmation. It closes on confirm and a Toast says what came of it.
 */
export function DeleteFile({ versionId, file, asking, onClose }: { versionId: number; file: FileSummary | null; asking: boolean; onClose: () => void }) {
  const del = useDeleteFiles()
  const report = useReport()
  const confirm = (blocklist: boolean) => {
    onClose()
    void report(del.mutateAsync({ versionId, blocklist }), deletion(blocklist))
  }
  return file && asking ? <DeleteFilesConfirm paths={[file.path]} bytes={file.size} onConfirm={confirm} onCancel={onClose} /> : null
}

/**
 * A deletion in the episode grid waiting for its confirmation. `at` is the
 * grid row it was asked from (episodeRow, seasonRow), where it shows; null for
 * the ticked episodes, whose confirmation shows by the selection bar.
 */
type Plan = { version: EpisodeVersion; label: string; scope: EpisodeScope; files: EpisodeFile[]; episodes: string[]; extra: string[]; at: string | null }

export type EpisodeDeletes = {
  /** Whether a Version holds a file for any of `eps`. */
  has: (v: EpisodeVersion, eps: Episode[]) => boolean
  /** Asks to delete the files of `v` holding `eps`, sent with `scope` and named `label`, asked from grid row `at` (null: the selection bar). */
  ask: (v: EpisodeVersion, eps: Episode[], label: string, scope: EpisodeScope, at: string | null) => void
  pending: Plan | null
  confirm: (blocklist: boolean) => void
  cancel: () => void
}

const filesOf = (v: EpisodeVersion, eps: Episode[]) => {
  const out = new Map<number, EpisodeFile>()
  for (const e of eps) {
    const f = e.cells[v.slot]?.file
    if (f) out.set(f.id, f)
  }
  return [...out.values()]
}

/** The episode grid's deletions: one waits for its confirmation at a time; a Toast reports what came of it. */
export function useEpisodeDeletes(episodes: Episode[]): EpisodeDeletes {
  const del = useDeleteFiles()
  const report = useReport()
  const [pending, setPending] = useState<Plan | null>(null)

  const ask: EpisodeDeletes['ask'] = (version, eps, label, scope, at) => {
    const fs = filesOf(version, eps)
    if (fs.length === 0) return
    const chosen = new Set(eps.map((e) => e.id))
    const losing = new Set(fs.flatMap((f) => f.episode_ids))
    const lost = episodes.filter((e) => losing.has(e.id))
    setPending({
      version,
      label,
      scope,
      files: fs,
      episodes: lost.map(episodeCode),
      extra: lost.filter((e) => !chosen.has(e.id)).map(episodeCode),
      at,
    })
  }

  const confirm = (blocklist: boolean) => {
    if (!pending) return
    const { version, scope, label } = pending
    setPending(null)
    void report(del.mutateAsync({ versionId: version.id, scope, blocklist }), deletion(blocklist, label))
  }

  return {
    has: (v, eps) => filesOf(v, eps).length > 0,
    ask,
    pending,
    confirm,
    cancel: () => setPending(null),
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
  at,
}: {
  deletes: EpisodeDeletes
  versions: EpisodeVersion[]
  episodes: Episode[]
  label: string
  scope: EpisodeScope
  text: string
  /** The grid row the menu belongs to. */
  at: string
}) {
  return versions.map((v) => {
    const has = deletes.has(v, episodes)
    return (
      <Menu.Item key={`delete-${v.slot}`} disabled={!has} description={has ? undefined : 'No file to delete'} onSelect={() => deletes.ask(v, episodes, label, scope, at)}>
        {versions.length > 1 ? `${text} ${slotLabel[v.slot]}` : text}
      </Menu.Item>
    )
  })
}

/** The selection bar's Delete files, one per Slot when the Series has both. */
export function DeleteTickedButtons({ deletes, versions, ticked, label }: { deletes: EpisodeDeletes; versions: EpisodeVersion[]; ticked: Episode[]; label: string }) {
  return versions.map((v) => {
    const has = deletes.has(v, ticked)
    return (
      <Button
        key={v.slot}
        variant="secondary"
        size="small"
        disabled={!has}
        title={has ? undefined : 'No file to delete'}
        onClick={() => deletes.ask(v, ticked, label, { episode_ids: ticked.map((e) => e.id) }, null)}
      >
        {versions.length > 1 ? `Delete files ${slotLabel[v.slot]}` : 'Delete files'}
      </Button>
    )
  })
}

/** The waiting deletion's confirmation where it was asked from: grid row `at`, or (null) by the selection bar. */
export function EpisodeDeleteConfirm({ deletes, at = null }: { deletes: EpisodeDeletes; at?: string | null }) {
  const p = deletes.pending
  if (!p || p.at !== at) return null
  return (
    <DeleteFilesConfirm
      paths={p.files.map((f) => f.path)}
      bytes={p.files.reduce((n, f) => n + f.size, 0)}
      episodes={p.episodes}
      extra={p.extra}
      onConfirm={deletes.confirm}
      onCancel={deletes.cancel}
    />
  )
}

/**
 * The confirmation of a deletion asked from grid row `at`, as a row of its own
 * right under it, so it shows where the menu was. Keys typed in it stay in it:
 * the grid's own (arrows, Enter on a season) must not also act.
 */
export function RowDeleteConfirm({ deletes, at, columns }: { deletes: EpisodeDeletes; at: string; columns: number }) {
  if (deletes.pending?.at !== at) return null
  return (
    <div role="row">
      <div role="gridcell" aria-colspan={columns} className="px-3 pb-2" onKeyDown={(e) => e.stopPropagation()}>
        <EpisodeDeleteConfirm deletes={deletes} at={at} />
      </div>
    </div>
  )
}
