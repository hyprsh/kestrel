import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'
import { Button, ErrorText, TextInput } from '../forms'

type Kind = 'movies' | 'series'
type Folders = Settings['root_folders']
type Paths = Record<Kind, string>

const kinds: { key: Kind; kids: 'kids_movies' | 'kids_series'; label: string; sibling: string }[] = [
  { key: 'movies', kids: 'kids_movies', label: 'Movies', sibling: 'kids-movies' },
  { key: 'series', kids: 'kids_series', label: 'Series', sibling: 'kids-tv' },
]

/** A sibling of the kind's first folder, or '' while there is no folder to sit beside. */
function siblingOf(first: string | undefined, name: string) {
  const path = (first ?? '').trim().replace(/\/+$/, '')
  return path === '' ? '' : `${path.slice(0, path.lastIndexOf('/'))}/${name}`
}

/**
 * The Root folders, shared by the wizard and Settings: one or more per kind,
 * prefilled from the server. The first of each kind is the default when adding
 * a Title. With "Keep kids’ titles in their own folders" each kind also has a
 * Kids root folder, which takes the Titles whose HD Profile is a Kids one. The
 * API keeps it in the kind's list; the form keeps it out of the visible list.
 * The server checks that each exists, is a directory and is writable.
 */
export function RootFoldersForm() {
  const { data, isError } = useSettings()
  if (isError) return <p className="text-[12px] text-red-900">Could not load the root folders.</p>
  if (!data) return null
  return <Form saved={data.root_folders} />
}

function Form({ saved }: { saved: Folders }) {
  const [keepKids, setKeepKids] = useState(saved.kids_movies !== '' || saved.kids_series !== '')
  const [kidsPaths, setKidsPaths] = useState<Paths>({ movies: saved.kids_movies, series: saved.kids_series })
  // A saved Kids folder leaves its list, unless it is the list's only folder.
  const [folders, setFolders] = useState<Pick<Folders, Kind>>(() => {
    const visible = (list: string[], kids: string) => (kids !== '' && list.length > 1 ? list.filter((p) => p !== kids) : list)
    return { movies: visible(saved.movies, saved.kids_movies), series: visible(saved.series, saved.kids_series) }
  })
  // Where the last save appended each Kids path in the list it sent, to show that list's error at the Kids field.
  const [appended, setAppended] = useState<Record<Kind, number>>({ movies: -1, series: -1 })
  const save = usePatchSettings()

  const set = (kind: Kind, list: string[]) => setFolders((f) => ({ ...f, [kind]: list }))
  const setKids = (kind: Kind, path: string) => setKidsPaths((k) => ({ ...k, [kind]: path }))
  const toggle = (on: boolean) => {
    setKeepKids(on)
    for (const { key, sibling } of kinds) {
      const old = kidsPaths[key].trim()
      if (on) {
        if (old === '') setKids(key, siblingOf(folders[key][0], sibling))
      } else {
        // A folder that may hold Titles stays a Root folder: show it in the list now.
        if (old !== '' && !folders[key].some((p) => p.trim() === old)) set(key, [...folders[key], old])
        setKids(key, '')
      }
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const lists = { movies: folders.movies.map((p) => p.trim()), series: folders.series.map((p) => p.trim()) }
    const kids: Paths = { movies: keepKids ? kidsPaths.movies.trim() : '', series: keepKids ? kidsPaths.series.trim() : '' }
    const at: Record<Kind, number> = { movies: -1, series: -1 }
    for (const { key } of kinds) {
      if (kids[key] !== '' && !lists[key].includes(kids[key])) at[key] = lists[key].push(kids[key]) - 1
    }
    setAppended(at)
    save.mutate({ root_folders: { ...lists, kids_movies: kids.movies, kids_series: kids.series } })
  }
  const fields = save.error instanceof ApiError ? save.error.fields : []
  const otherError = save.isError && fields.length === 0

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      {kinds.map(({ key, label }) => (
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
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={keepKids} onChange={(e) => toggle(e.target.checked)} />
        Keep kids’ titles in their own folders
      </label>
      {keepKids &&
        kinds.map(({ key, kids, label }) => {
          const problems = fields.filter((f) => f.field === `root_folders.${kids}` || (appended[key] >= 0 && f.field === `root_folders.${key}[${appended[key]}]`))
          return (
            <div key={key} className="flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-gray-900">
                Kids {label} folder
                <TextInput
                  aria-invalid={problems.length > 0 ? true : undefined}
                  className="font-mono"
                  value={kidsPaths[key]}
                  onChange={(e) => setKids(key, e.target.value)}
                />
              </label>
              {problems.map((f) => (
                <ErrorText key={f.field}>{f.message}</ErrorText>
              ))}
            </div>
          )
        })}
      <p className="text-[12px] text-gray-900">
        Each folder must exist and be writable by Kestrel. Keep them on the same mount as your downloads so Imports can hardlink. New Titles the
        Kids rule catches, or that get a Kids Profile in HD, go in the Kids folders, so a media server can show them as their own library.
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
