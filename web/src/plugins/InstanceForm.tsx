import { useState, type FormEvent } from 'react'
import {
  ApiError,
  useDeletePluginInstance,
  useSavePluginInstance,
  useTestPlugin,
  type PluginConfig,
  type PluginField,
  type PluginInstance,
  type PluginManifest,
  type PluginOption,
} from '../api/queries'
import { Button, ErrorText, Field, Select, TextInput } from '../forms'

type Values = Record<string, string | boolean>

/** Name, Enabled and Priority: what a form that manages several instances adds to the manifest's fields. */
type Meta = { name: string; enabled: boolean; priority: string }

const initial = (manifest: PluginManifest, instance?: PluginInstance): Values => {
  const v: Values = {}
  for (const f of manifest.fields) {
    if (f.type === 'secret') continue // write-only: the form never holds a saved secret
    const stored = instance?.config[f.key] ?? f.default
    v[f.key] = f.type === 'bool' ? stored === true : stored == null ? '' : String(stored)
  }
  return v
}

/** What the form sends. A secret left blank is omitted, so a saved one is kept. */
function toConfig(manifest: PluginManifest, values: Values, secrets: Record<string, string>): PluginConfig {
  const config: PluginConfig = {}
  for (const f of manifest.fields) {
    if (f.type === 'secret') {
      if (secrets[f.key]) config[f.key] = secrets[f.key]
      continue
    }
    const raw = values[f.key]
    if (f.type === 'bool') config[f.key] = raw === true
    else if (raw === '' || raw === undefined) config[f.key] = null
    else if (f.type === 'int') config[f.key] = Number(raw)
    else config[f.key] = raw
  }
  return config
}

/**
 * A plugin's settings form, drawn from its manifest: it works for any plugin of any
 * contract. Test connection shows the live result and, once the connection works,
 * turns the manifest's `live` fields into dropdowns of what the plugin reports.
 */
export function InstanceForm({
  manifest,
  instance,
  managed,
  label,
  onSaved,
}: {
  manifest: PluginManifest
  instance?: PluginInstance
  /** Adds Name, Enabled and Priority to the form, for plugins of which many instances may exist. */
  managed?: boolean
  /** The form's accessible name; defaults to the plugin's. */
  label?: string
  onSaved?: () => void
}) {
  const [values, setValues] = useState<Values>(() => initial(manifest, instance))
  const [meta, setMeta] = useState<Meta>(() => ({
    name: instance?.name ?? '',
    enabled: instance?.enabled ?? true,
    priority: String(instance?.priority ?? 0),
  }))
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const test = useTestPlugin()
  const save = useSavePluginInstance()
  const remove = useDeletePluginInstance()

  const config = () => toConfig(manifest, values, secrets)
  const options: Record<string, PluginOption[]> = test.data?.result.ok ? test.data.options : {}

  const runTest = () => test.mutate({ manifest, config: config(), instance })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        pluginId: manifest.id,
        name: manifest.name,
        config: config(),
        instance,
        managed: managed ? { name: meta.name.trim(), enabled: meta.enabled, priority: Number(meta.priority) || 0 } : undefined,
      },
      {
        onSuccess: () => {
          setSecrets({}) // a saved secret is never shown again
          onSaved?.()
        },
      },
    )
  }

  const setMetaField = (patch: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...patch }))
    save.reset()
  }

  const set = (key: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    save.reset()
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3" aria-label={label ?? `${manifest.name} settings`}>
      {managed && (
        <>
          <Field label="Name">{(id) => <TextInput id={id} value={meta.name} onChange={(e) => setMetaField({ name: e.target.value })} />}</Field>
          <div className="flex items-end gap-4">
            <Field label="Priority">
              {(id) => <TextInput id={id} type="number" className="w-24" value={meta.priority} onChange={(e) => setMetaField({ priority: e.target.value })} />}
            </Field>
            <Field label="Enabled">
              {(id) => <input id={id} type="checkbox" className="mb-2" checked={meta.enabled} onChange={(e) => setMetaField({ enabled: e.target.checked })} />}
            </Field>
          </div>
        </>
      )}
      {manifest.fields.map((f) => (
        <Field key={f.key} label={f.label}>
          {(id) => <Control id={id} field={f} instance={instance} value={values[f.key]} secret={secrets[f.key] ?? ''} live={options[f.key]} onValue={(v) => set(f.key, v)} onSecret={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))} />}
        </Field>
      ))}

      {test.isError && <ErrorText>Could not run the test. Try again.</ErrorText>}
      {test.data &&
        (test.data.result.ok ? (
          <p role="status" className="text-[12px] text-green-900">
            Connected: {test.data.result.message}
          </p>
        ) : (
          <ErrorText>{test.data.result.message}</ErrorText>
        ))}
      {save.isError && <ErrorText>{save.error instanceof ApiError ? save.error.message : 'Could not save. Try again.'}</ErrorText>}
      {save.isSuccess && <p role="status" className="text-[12px] text-green-900">Saved.</p>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={test.isPending} onClick={runTest}>
          Test connection
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
        {instance && (
          <Button type="button" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(instance.id)}>
            Remove
          </Button>
        )}
      </div>
    </form>
  )
}

function Control({
  id,
  field,
  instance,
  value,
  secret,
  live,
  onValue,
  onSecret,
}: {
  id: string
  field: PluginField
  instance?: PluginInstance
  value: string | boolean | undefined
  secret: string
  live?: PluginOption[]
  onValue: (v: string | boolean) => void
  onSecret: (v: string) => void
}) {
  const text = typeof value === 'string' ? value : ''
  switch (field.type) {
    case 'secret': {
      const isSet = instance?.secrets_set.includes(field.key)
      return (
        <TextInput
          id={id}
          type="password"
          autoComplete="off"
          value={secret}
          placeholder={isSet ? 'Saved. Leave blank to keep it.' : ''}
          onChange={(e) => onSecret(e.target.value)}
        />
      )
    }
    case 'bool':
      return <input id={id} type="checkbox" checked={value === true} onChange={(e) => onValue(e.target.checked)} />
    case 'select':
      return (
        <Select id={id} value={text} onChange={(e) => onValue(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )
    default:
      if (live) {
        const choices = live.some((o) => o.value === text) || text === '' ? live : [{ value: text, label: text }, ...live]
        return (
          <Select id={id} value={text} onChange={(e) => onValue(e.target.value)}>
            {choices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )
      }
      return <TextInput id={id} type={field.type === 'int' ? 'number' : 'text'} value={text} onChange={(e) => onValue(e.target.value)} />
  }
}
