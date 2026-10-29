import { Button, Note, Select, Toggle } from '@hyprsh/design'
import { useState, type FormEvent } from 'react'
import { ApiError, usePluginInstances } from '../api/queries'
import { useSaveSiloSettings, useSiloSettings, type Silo } from '../api/silo'

/** The messages of a 422's field errors at `field`. The server may prefix them with the section's name. */
function problems(error: unknown, field: string): string[] {
  if (!(error instanceof ApiError)) return []
  return error.fields.filter((f) => f.field.replace(/^silo\./, '') === field).map((f) => f.message)
}

/** The Silo card of Settings: Watch-ahead for Series requested in Silo, and the Silo server whose playback history it reads. */
export function SiloSettingsForm() {
  const { data, isError } = useSiloSettings()
  const instances = usePluginInstances()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the Silo settings.
      </Note>
    )
  if (!data || !instances.data) return null
  const silo = instances.data.filter((i) => i.plugin_id === 'silo').map((i) => i.name)
  return <Form saved={data} instances={silo} />
}

function Form({ saved, instances }: { saved: Silo; instances: string[] }) {
  const [watchAhead, setWatchAhead] = useState(saved.watch_ahead)
  const [instance, setInstance] = useState(saved.instance ?? '')
  const save = useSaveSiloSettings()
  const declared = saved.from_config_file

  const names = instance && !instances.includes(instance) ? [instance, ...instances] : instances
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ watch_ahead: watchAhead, instance: instance || null })
  }

  const unmatched = save.error instanceof ApiError && save.error.status === 422 ? save.error.fields.filter((f) => !problems(save.error, 'instance').includes(f.message)) : []

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <fieldset disabled={declared} className="contents">
        <Toggle checked={watchAhead} onChange={setWatchAhead} labelCasing="normal">
          Watch-ahead for Series requested in Silo
        </Toggle>
        <Select
          size="small"
          label="Silo instance"
          value={instance}
          onChange={(e) => setInstance(e.target.value)}
          hint={names.length === 0 ? 'Add a Silo media server first: Watch-ahead reads who watched what from its playback history.' : undefined}
          error={problems(save.error, 'instance')[0]}
          options={[{ value: '', label: 'None' }, ...names.map((n) => ({ value: n, label: n }))]}
        />
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
          Save Silo settings
        </Button>
      </fieldset>
      {declared && <Note size="small">The Config File sets Silo, so it cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </form>
  )
}
