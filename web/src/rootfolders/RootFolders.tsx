import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'
import { Button, DeclaredNote, ErrorText, TextInput } from '../forms'

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
  if (isError) return <p className="text-[12px] text-red-900">Could not load the root folders.</p>
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
          <legend className="mb-1 text-[12px] font-medium text-gray-900">{label}</legend>
          {folders[key].map((path, i) => {
            const name = `${label} folder ${i + 1}`
            const problem = fields.find((f) => f.field === `root_folders.${key}[${i}]`)
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <TextInput
                    aria-label={name}
                    aria-invalid={problem ? true : undefined}
                    className="font-mono"
                    value={path}
                    onChange={(e) => set(key, folders[key].map((p, j) => (j === i ? e.target.value : p)))}
                  />
                  {i === 0 ? (
                    <span className="w-[5.5rem] shrink-0 text-center text-[12px] text-gray-900">Default</span>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label={`Make ${name} the default`}
                      className="shrink-0"
                      onClick={() => set(key, [path, ...folders[key].filter((_, j) => j !== i)])}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Remove ${name}`}
                    disabled={folders[key].length === 1}
                    onClick={() => set(key, folders[key].filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
                {problem && <ErrorText>{problem.message}</ErrorText>}
              </div>
            )
          })}
          <Button type="button" variant="secondary" aria-label={`Add ${label} folder`} className="self-start" onClick={() => set(key, [...folders[key], ''])}>
            Add folder
          </Button>
          {fields
            .filter((f) => f.field === `root_folders.${key}`)
            .map((f) => (
              <ErrorText key={f.field}>{f.message}</ErrorText>
            ))}
        </fieldset>
      ))}
      <p className="text-[12px] text-gray-900">Each folder must exist and be writable by Kestrel. Keep them on the same mount as your downloads so Imports can hardlink.</p>
      {otherError && <ErrorText>Could not save. Try again.</ErrorText>}
      {save.isSuccess && (
        <p role="status" className="text-[12px] text-green-900">
          Saved.
        </p>
      )}
      <Button type="submit" disabled={save.isPending || declared} className="self-start">
        Save root folders
      </Button>
      {declared && <DeclaredNote>The Config File sets the root folders, so they cannot be changed here.</DeclaredNote>}
    </form>
  )
}
