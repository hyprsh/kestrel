import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'
import { Button, ErrorText, Select, TextInput } from '../forms'

type Kind = 'movies' | 'series'
type Folders = Settings['root_folders']

const kinds: { key: Kind; kids: 'kids_movies' | 'kids_series'; label: string }[] = [
  { key: 'movies', kids: 'kids_movies', label: 'Movies' },
  { key: 'series', kids: 'kids_series', label: 'Series' },
]

/**
 * The Root folders, shared by the wizard and Settings: one or more per kind,
 * prefilled from the server. The first of each kind is the default when adding
 * a Title; the optional Kids root folder, one of the kind's folders, takes the
 * Titles whose HD Profile is a Kids one. The server checks that each exists, is
 * a directory and is writable.
 */
export function RootFoldersForm() {
  const { data, isError } = useSettings()
  if (isError) return <p className="text-[12px] text-red-900">Could not load the root folders.</p>
  if (!data) return null
  return <Form saved={data.root_folders} />
}

function Form({ saved }: { saved: Folders }) {
  const [folders, setFolders] = useState<Folders>(saved)
  const save = usePatchSettings()

  const set = (kind: Kind, list: string[]) => setFolders((f) => ({ ...f, [kind]: list }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      root_folders: {
        movies: folders.movies.map((p) => p.trim()),
        series: folders.series.map((p) => p.trim()),
        kids_movies: folders.kids_movies.trim(),
        kids_series: folders.kids_series.trim(),
      },
    })
  }
  const fields = save.error instanceof ApiError ? save.error.fields : []
  const otherError = save.isError && fields.length === 0

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      {kinds.map(({ key, kids, label }) => (
        <fieldset key={key} className="flex flex-col gap-2">
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
                    disabled={folders[key].length === 1 || (folders[kids] !== '' && path === folders[kids])}
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
            .filter((f) => f.field === `root_folders.${key}` || f.field === `root_folders.${kids}`)
            .map((f) => (
              <ErrorText key={f.field}>{f.message}</ErrorText>
            ))}
          <label className="mt-1 flex items-center gap-3 text-[12px] font-medium text-gray-900">
            Kids folder
            <Select aria-label={`Kids ${label} folder`} value={folders[kids]} onChange={(e) => setFolders((f) => ({ ...f, [kids]: e.target.value }))} className="max-w-72">
              <option value="">Off</option>
              {folders[key]
                .filter((p) => p.trim() !== '')
                .map((p) => (
                  <option key={p}>{p}</option>
                ))}
            </Select>
          </label>
        </fieldset>
      ))}
      <p className="text-[12px] text-gray-900">
        Each folder must exist and be writable by Kestrel. Keep them on the same mount as your downloads so Imports can hardlink. New Titles
        whose HD Profile is a Kids one go in the Kids folder, so your media server can show them as their own library.
      </p>
      {otherError && <ErrorText>Could not save. Try again.</ErrorText>}
      {save.isSuccess && (
        <p role="status" className="text-[12px] text-green-900">
          Saved.
        </p>
      )}
      <Button type="submit" disabled={save.isPending} className="self-start">
        Save root folders
      </Button>
    </form>
  )
}
