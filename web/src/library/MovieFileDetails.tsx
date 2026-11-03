import { Badge, Button, Modal } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { TitleDetail } from '../api/queries'
import { size } from './bits'
import { importedOn, EndOfPath } from './EpisodeFilePopover'
import { audioLine, qualityName } from './media'

type File = NonNullable<TitleDetail['versions'][number]['file']>

/** A fact of a file: a small label over its value. */
function Fact({ k, children, wide }: { k: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-2 max-sm:col-span-1' : ''}`}>
      <span className="label-12 text-gray-900">{k}</span>
      <span className="label-13 min-w-0 break-words">{children}</span>
    </div>
  )
}

/** A Movie Version's File Details…: what is known of the file it holds (Quality, Video, Audio, Score and its Custom Formats, Size, Imported, Path). */
export function MovieFileDetails({ name, file: f, onClose }: { name: string; file: File; onClose: () => void }) {
  const audio = audioLine(f)
  const on = importedOn(f.imported_at)
  const formats = f.custom_formats ?? []
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
        <div className="grid grid-cols-4 gap-3 max-sm:grid-cols-2">
          <Fact k="Quality">{f.quality ? qualityName(f.quality) : '—'}</Fact>
          <Fact k="Video">{[f.video_codec, f.hdr ?? 'SDR'].filter(Boolean).join(' · ') || '—'}</Fact>
          <Fact k="Audio">{audio || '—'}</Fact>
          <Fact k="Custom Format Score">{f.score === null || f.score === undefined ? '—' : `${f.score > 0 ? '+' : ''}${f.score.toLocaleString()}`}</Fact>
          {formats.length > 0 && (
            <Fact k="Custom Formats" wide>
              <span className="flex flex-wrap gap-1">
                {formats.map((c) => (
                  <Badge key={c.name} variant="gray" contrast="low" size="sm">
                    {`${c.name} ${c.points < 0 ? '−' : '+'}${Math.abs(c.points)}`}
                  </Badge>
                ))}
              </span>
            </Fact>
          )}
          <Fact k="Size">{size(f.size)}</Fact>
          <Fact k="Imported">{[on, f.release_group ? `from ${f.release_group}` : null].filter(Boolean).join(' · ') || '—'}</Fact>
          <Fact k="Path" wide>
            <EndOfPath path={f.path} className="label-12-mono text-gray-900" />
          </Fact>
        </div>
        {f.misfit && <span className="label-12 text-red-900">No longer fits this Profile</span>}
      </div>
    </Modal>
  )
}
