import { useState } from 'react'
import { useMoveTitle } from '../api/move'
import { ApiError, useSettings, type TitleDetail } from '../api/queries'
import { Button, ErrorText } from '../forms'

/**
 * "Move": puts the Title in another of its kind's Root folders. The picker lists
 * them with the current one marked; the folder keeps its name, and the API
 * refuses (with a reason shown here) when the target is on another filesystem,
 * already holds a folder of that name, or an Import into the Title is running.
 */
export function MoveTitle({ title }: { title: TitleDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      {open ? (
        <Picker title={title} onClose={() => setOpen(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Move
        </Button>
      )}
    </div>
  )
}

function Picker({ title, onClose }: { title: TitleDetail; onClose: () => void }) {
  const settings = useSettings()
  const move = useMoveTitle(title.id)
  const [picked, setPicked] = useState(title.root_folder)
  const folders = settings.data ? settings.data.root_folders[title.kind === 'series' ? 'series' : 'movies'] : []
  const name = `move-${title.id}`
  return (
    <div role="group" aria-label="Move Title" className="rounded-md border border-gray-alpha-400 p-2 text-[12px]">
      <div role="radiogroup" aria-label="Root folder" className="space-y-1">
        {folders.map((f) => (
          <label key={f} className="flex items-center gap-2 font-mono text-[11px]">
            <input type="radio" name={name} value={f} checked={picked === f} onChange={() => setPicked(f)} />
            {f}
            {f === title.root_folder && (
              <>
                {' '}
                <span className="font-sans text-gray-900">(current)</span>
              </>
            )}
          </label>
        ))}
      </div>
      {settings.isError && <ErrorText>Could not load the Root folders.</ErrorText>}
      {move.isError && <ErrorText>{move.error instanceof ApiError ? move.error.message : 'Could not move this Title.'}</ErrorText>}
      <div className="mt-2 flex gap-2">
        <Button className="h-7" disabled={picked === title.root_folder || move.isPending} onClick={() => move.mutate(picked, { onSuccess: onClose })}>
          Move here
        </Button>
        <Button variant="secondary" className="h-7" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
