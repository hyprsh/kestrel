import { Button, Note, Select, Textarea, Toggle, Input } from '@hyprsh/design'
import { useState, type FormEvent } from 'react'
import { usePlexSignIn, useSavePlexSignIn, type PlexSignIn } from '../api/plex'
import { ApiError, usePluginInstances, useSettings } from '../api/queries'

type Row = { user: string; movies: string | null; series: string | null }

/** The messages of a 422's field errors at `field` or below it (`users`, `users[1]`). The server may prefix them with the section's name. */
function problems(error: unknown, field: string): string[] {
  if (!(error instanceof ApiError)) return []
  return error.fields
    .filter((f) => {
      const name = f.field.replace(/^plex_sign_in\./, '')
      return name === field || name.startsWith(`${field}[`) || name.startsWith(`${field}.`)
    })
    .map((f) => f.message)
}

/** The Plex sign-in card of Settings > Security: who may sign in as a Requester, and where their Requests go. */
export function PlexSignInForm() {
  const { data, isError } = usePlexSignIn()
  const instances = usePluginInstances()
  const settings = useSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the Plex sign-in settings.
      </Note>
    )
  if (!data || !instances.data || !settings.data) return null
  const plex = instances.data.filter((i) => i.plugin_id === 'plex').map((i) => i.name)
  return <Form saved={data} instances={plex} folders={settings.data.root_folders} />
}

function Form({ saved, instances, folders }: { saved: PlexSignIn; instances: string[]; folders: { movies: string[]; series: string[] } }) {
  const [enabled, setEnabled] = useState(saved.enabled)
  const [instance, setInstance] = useState(saved.instance ?? '')
  const [users, setUsers] = useState(saved.users.join('\n'))
  const [rows, setRows] = useState<Row[]>(saved.user_root_folders)
  const [watchlist, setWatchlist] = useState(saved.watchlist)
  const [watchAhead, setWatchAhead] = useState(saved.watch_ahead)
  const [labels, setLabels] = useState(saved.labels)
  const [posterBadge, setPosterBadge] = useState(saved.poster_badge)
  const [badgeDays, setBadgeDays] = useState(saved.poster_badge_days === null ? '' : String(saved.poster_badge_days))
  const save = useSavePlexSignIn()
  const declared = saved.from_config_file

  const names = instance && !instances.includes(instance) ? [instance, ...instances] : instances
  const setRow = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      enabled,
      instance: instance || null,
      users: users
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter(Boolean),
      user_root_folders: rows.map((r) => ({ ...r, user: r.user.trim() })).filter((r) => r.user),
      watchlist,
      watch_ahead: watchAhead,
      labels,
      poster_badge: posterBadge,
      poster_badge_days: badgeDays.trim() === '' ? null : Number(badgeDays),
    })
  }

  const badgeError = problems(save.error, 'poster_badge_days')[0]
  const unmatched =
    save.error instanceof ApiError && save.error.status === 422
      ? save.error.fields.filter((f) => !['instance', 'users', 'user_root_folders', 'poster_badge_days'].some((k) => problems(save.error, k).includes(f.message)))
      : []

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <fieldset disabled={declared} className="contents">
        <Toggle checked={enabled} onChange={setEnabled} labelCasing="normal">
          Let people sign in with Plex
        </Toggle>
        <Select
          size="small"
          label="Plex instance"
          value={instance}
          onChange={(e) => setInstance(e.target.value)}
          placeholder="Choose a Plex instance"
          hint={names.length === 0 ? 'Add a Plex media server first: its server and owner token decide who may sign in.' : undefined}
          error={problems(save.error, 'instance')[0]}
          options={names.map((n) => ({ value: n, label: n }))}
        />
        <Textarea
          label="Users"
          rows={3}
          value={users}
          onChange={(e) => setUsers(e.target.value)}
          hint="Plex usernames or Plex Home user names, one per line. Leave empty to let everyone with access to the Plex server request."
          error={problems(save.error, 'users')[0]}
        />
        <div className="flex flex-col gap-3">
          <h4 className="label-13 text-gray-900">Root folders per user</h4>
          {rows.length === 0 && <p className="copy-13 text-gray-900">Every user&apos;s Requests go to the first Root folder of their kind.</p>}
          {rows.map((r, i) => {
            const error = problems(save.error, `user_root_folders[${i}]`)[0]
            return (
              <div key={i} role="group" aria-label={`Root folders for user ${i + 1}`} className="flex flex-col gap-2">
                <Input size="small" label="User" value={r.user} onChange={(e) => setRow(i, { user: e.target.value })} error={error} />
                <Select
                  size="small"
                  label="Movie Root folder"
                  value={r.movies ?? ''}
                  onChange={(e) => setRow(i, { movies: e.target.value || null })}
                  options={[{ value: '', label: 'First Root folder' }, ...folders.movies.map((p) => ({ value: p, label: p }))]}
                />
                <Select
                  size="small"
                  label="Series Root folder"
                  value={r.series ?? ''}
                  onChange={(e) => setRow(i, { series: e.target.value || null })}
                  options={[{ value: '', label: 'First Root folder' }, ...folders.series.map((p) => ({ value: p, label: p }))]}
                />
                <Button size="small" className="self-start" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                  Remove user
                </Button>
              </div>
            )
          })}
          <Button size="small" className="self-start" onClick={() => setRows((all) => [...all, { user: '', movies: null, series: null }])}>
            Add user
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          <h4 className="label-13 text-gray-900">Watchlists and marks in Plex</h4>
          <Toggle checked={watchlist} onChange={setWatchlist} labelCasing="normal">
            Make Requests from Watchlists
          </Toggle>
          <Toggle checked={watchAhead} onChange={setWatchAhead} labelCasing="normal">
            Watch-ahead for Series
          </Toggle>
          <Toggle checked={labels} onChange={setLabels} labelCasing="normal">
            Requested labels in Plex
          </Toggle>
          <Toggle checked={posterBadge} onChange={setPosterBadge} labelCasing="normal">
            Requested poster badge in Plex
          </Toggle>
          <Input
            size="small"
            label="Poster badge days"
            type="number"
            className="w-24"
            placeholder="30"
            value={badgeDays}
            onChange={(e) => setBadgeDays(e.target.value)}
            hint={badgeError ? undefined : 'How long the badge stays on a poster. Leave empty for 30 days.'}
            error={badgeError}
          />
        </div>
        {unmatched.map((f) => (
          <Note key={`${f.field}-${f.message}`} variant="error" size="small">
            {f.message}
          </Note>
        ))}
        {save.isError && !(save.error instanceof ApiError && save.error.status === 422) && (
          <Note variant="error" size="small">
            Could not save. Try again.
          </Note>
        )}
        {save.isSuccess && (
          <Note variant="success" size="small">
            Saved.
          </Note>
        )}
        <Button size="small" variant="primary" typeName="submit" disabled={save.isPending} className="self-start">
          Save Plex sign-in
        </Button>
      </fieldset>
      {declared && <Note size="small">The Config File sets Plex sign-in, so it cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </form>
  )
}
