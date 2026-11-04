import { Button, Modal } from '@hyprsh/design'
import type { TitleDetail } from '../api/queries'
import { size } from './bits'
import { importedOn, EndOfPath } from './EpisodeFilePopover'
import { ReleaseFacts, type Row } from './ReleaseFacts'

type File = NonNullable<TitleDetail['versions'][number]['file']>

/** A Movie Version's File Details…: what is known of the file it holds (Quality, Video, Audio, Score and its Custom Formats, Size, Imported, Path). */
export function MovieFileDetails({ name, file: f, onClose }: { name: string; file: File; onClose: () => void }) {
  const on = importedOn(f.imported_at)
  const extra: Row[] = []
  if (on) extra.push(['Imported', on])
  extra.push(['Path', <EndOfPath key="path" path={f.path} className="label-12-mono text-gray-900" />])
  return (
    <Modal
      open
      size="medium"
      title={`${name} File Details`}
      onClose={onClose}
      actions={
        <Button variant="secondary" size="small" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ReleaseFacts facts={{ ...f, size: size(f.size), group: f.release_group, formats: f.custom_formats }} extra={extra} />
        {f.misfit && <span className="label-12 text-red-900">No longer fits this Profile</span>}
      </div>
    </Modal>
  )
}
