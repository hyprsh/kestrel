import { useState } from 'react'
import { useMoveTitle } from '../api/titleActions'
import { ApiError, useSettings, type TitleDetail } from '../api/queries'
import { Button, Note, RadioGroup, RadioGroupItem } from '@hyprsh/design'

/**
 * "Move" (in the Title actions' "…" menu): puts the Title in another of its
 * kind's Root folders. The picker lists them with the current one marked; the
 * folder keeps its name, and the API refuses (with a reason shown here) when the
 * target is on another filesystem, already holds a folder of that name, or an
 * Import into the Title is running.
 */
export function MoveTitle({ title, onClose }: { title: TitleDetail; onClose: () => void }) {
  const settings = useSettings()
  const move = useMoveTitle(title.id)
  const [picked, setPicked] = useState(title.root_folder)
  const folders = settings.data ? settings.data.root_folders[title.kind === 'series' ? 'series' : 'movies'] : []
  const name = `move-${title.id}`
  return (
    <div role="group" aria-label="Move Title" className="mt-2 rounded-md border border-gray-alpha-400 p-3">
      <RadioGroup aria-label="Root folder" name={name} value={picked} onChange={setPicked} className="gap-2">
        {folders.map((f) => (
          <RadioGroupItem key={f} value={f}>
            <span className="label-12-mono">{f}</span>
            {f === title.root_folder && (
              <>
                {' '}
                <span className="label-12 text-gray-900">(current)</span>
              </>
            )}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      {settings.isError && (
        <div className="mt-2">
          <Note variant="error" size="small">
            Could not load the Root folders.
          </Note>
        </div>
      )}
      {move.isError && (
        <div className="mt-2">
          <Note variant="error" size="small">
            {move.error instanceof ApiError ? move.error.message : 'Could not move this Title.'}
          </Note>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" size="small" disabled={picked === title.root_folder || move.isPending} onClick={() => move.mutate(picked, { onSuccess: onClose })}>
          Move here
        </Button>
        <Button variant="secondary" size="small" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
