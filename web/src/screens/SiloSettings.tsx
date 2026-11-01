import { Note, Select, Toggle } from '@hyprsh/design'
import { ApiError, usePluginInstances } from '../api/queries'
import { SettingRow, SettingsCard } from '../layout/SettingsPage'
import { useDraftForm } from '../settings/draft'
import { useSaveSiloSettings, useSiloSettings, type Silo } from '../api/silo'
import { SkeletonForm } from '../loading'

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
  if (!data || !instances.data) return <SkeletonForm rows={2} />
  const silo = instances.data.filter((i) => i.plugin_id === 'silo').map((i) => i.name)
  return <Form saved={data} instances={silo} />
}

function Form({ saved, instances }: { saved: Silo; instances: string[] }) {
  const save = useSaveSiloSettings()
  const declared = saved.from_config_file
  const { draft, set, dirty } = useDraftForm({
    id: 'silo',
    saved: { watchAhead: saved.watch_ahead, instance: saved.instance ?? '' },
    labels: { watchAhead: 'Watch-ahead', instance: 'Silo instance' },
    commit: (d) => save.mutateAsync({ watch_ahead: d.watchAhead, instance: d.instance || null }),
  })
  const names = draft.instance && !instances.includes(draft.instance) ? [draft.instance, ...instances] : instances
  const unmatched = save.error instanceof ApiError && save.error.status === 422 ? save.error.fields.filter((f) => !problems(save.error, 'instance').includes(f.message)) : []

  return (
    <>
      <SettingsCard>
        <SettingRow
          label="Watch-ahead"
          dirty={dirty('watchAhead')}
          help="Series requested whole in Silo start with season 1, and Kestrel adds the next season once 2 episodes of the newest one have been watched in Plex or Silo. The Kestrel plugin in Silo can override this per request route."
        >
          <Toggle aria-label="Watch-ahead for Series requested in Silo" checked={draft.watchAhead} disabled={declared} onChange={(watchAhead) => set({ watchAhead })} />
        </SettingRow>
        <SettingRow label="Silo instance" dirty={dirty('instance')} help="The Silo server whose playback history Watch-ahead reads.">
          <Select
            size="small"
            aria-label="Silo instance"
            value={draft.instance}
            disabled={declared}
            onChange={(e) => set({ instance: e.target.value })}
            hint={names.length === 0 ? 'Add a Silo media server first: Watch-ahead reads who watched what from its playback history.' : undefined}
            error={problems(save.error, 'instance')[0]}
            options={[{ value: '', label: 'None' }, ...names.map((n) => ({ value: n, label: n }))]}
          />
        </SettingRow>
      </SettingsCard>
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
      {declared && <Note size="small">The Config File sets Silo, so it cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </>
  )
}
