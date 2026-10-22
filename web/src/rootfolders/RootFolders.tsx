import { Button, Input, Note } from '@hyprsh/design'
import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'

type Kind = 'movies' | 'series'
type Folders = Settings['root_folders']

const kinds: { key: Kind; label: string }[] = [
  { key: 'movies', label: 'Movies' },
  { key: 'series', label: 'Series' },
]

/**
 * The Root folders, shared by the wizard and Settings: one or more per kind,
 * prefilled from the server. The first of each kind is the default when adding
 * a Title. The server checks that each exists, is a directory and is writable.
 */
export function RootFoldersForm() {
  const { data, isError } = useSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the root folders.
      </Note>
    )
  if (!data) return null
  return <Form saved={data.root_folders} declared={data.from_config_file.root_folders} />
}

function Form({ saved, declared }: { saved: Folders; declared: boolean }) {
  const [folders, setFolders] = useState<Pick<Folders, Kind>>({ movies: saved.movies, series: saved.series })
  const save = usePatchSettings()

  const set = (kind: Kind, list: string[]) => setFolders((f) => ({ ...f, [kind]: list }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ root_folders: { movies: folders.movies.map((p) => p.trim()), series: folders.series.map((p) => p.trim()) } })
  }
  const fields = save.error instanceof ApiError ? save.error.fields : []
  const otherError = save.isError && fields.length === 0

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      {kinds.map(({ key, label }) => (
        <fieldset key={key} disabled={declared} className="flex flex-col gap-2">
          <legend className="label-13 mb-1 text-gray-900">{label}</legend>
          {folders[key].map((path, i) => {
            const name = `${label} folder ${i + 1}`
            const problem = fields.find((f) => f.field === `root_folders.${key}[${i}]`)
            return (
              <div key={i} className="flex items-start gap-2">
                <Input
                  size="small"
                  aria-label={name}
                  error={problem?.message}
                  className="min-w-0 flex-1 font-mono"
                  value={path}
                  onChange={(e) =>
                    set(
                      key,
                      folders[key].map((p, j) => (j === i ? e.target.value : p)),
                    )
                  }
                />
                {i === 0 ? (
                  <span className="label-13 flex h-8 w-[5.5rem] shrink-0 items-center justify-center text-gray-900">Default</span>
                ) : (
                  <Button size="small" aria-label={`Make ${name} the default`} className="shrink-0" onClick={() => set(key, [path, ...folders[key].filter((_, j) => j !== i)])}>
                    Make default
                  </Button>
                )}
                <Button
                  size="small"
                  aria-label={`Remove ${name}`}
                  disabled={folders[key].length === 1}
                  onClick={() =>
                    set(
                      key,
                      folders[key].filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            )
          })}
          <Button size="small" aria-label={`Add ${label} folder`} className="self-start" onClick={() => set(key, [...folders[key], ''])}>
            Add folder
          </Button>
          {fields
            .filter((f) => f.field === `root_folders.${key}`)
            .map((f) => (
              <Note key={f.field} variant="error" size="small">
                {f.message}
              </Note>
            ))}
        </fieldset>
      ))}
      <p className="copy-13 text-gray-900">Each folder must exist and be writable by Kestrel. Keep them on the same mount as your downloads so Imports can hardlink.</p>
      {otherError && (
        <Note variant="error" size="small">
          Could not save. Try again.
        </Note>
      )}
      {save.isSuccess && (
        <div role="status">
          <Note variant="success" size="small">
            Saved.
          </Note>
        </div>
      )}
      <Button size="small" variant="primary" typeName="submit" disabled={save.isPending || declared} className="self-start">
        Save root folders
      </Button>
      {declared && <Note size="small">The Config File sets the root folders, so they cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </form>
  )
}
