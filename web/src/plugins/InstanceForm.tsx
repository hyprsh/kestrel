import { useState, type FormEvent } from 'react'
import {
  ApiError,
  useDeletePluginInstance,
  useSavePluginInstance,
  useSetInstanceEnabled,
  useTestPlugin,
  type PluginConfig,
  type PluginField,
  type PluginInstance,
  type PluginManifest,
  type PluginOption,
} from '../api/queries'
import { Button, Checkbox, Input, Note, Select } from '@hyprsh/design'

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
  onCancel,
}: {
  manifest: PluginManifest
  instance?: PluginInstance
  /** Adds Name, Enabled and Priority to the form, for plugins of which many instances may exist. */
  managed?: boolean
  /** The form's accessible name; defaults to the plugin's. */
  label?: string
  onSaved?: () => void
  /** Adds a Cancel button that calls this, for a form that opens in place. */
  onCancel?: () => void
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
  const toggle = useSetInstanceEnabled()
  const remove = useDeletePluginInstance()

  // The Config File declares the instance: it can be tested but not changed here.
  const declared = !!instance?.from_config_file
  // Unless the file leaves `enabled` out (ADR 0015): the form then saves that alone, as the row's switch does.
  const enabledOnly = !!managed && declared && !instance?.enabled_declared
  const saving = enabledOnly ? toggle : save
  const config = () => toConfig(manifest, values, secrets)
  const options: Record<string, PluginOption[]> = test.data?.result.ok ? test.data.options : {}

  const runTest = () => test.mutate({ manifest, config: config(), instance })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (enabledOnly && instance) {
      toggle.mutate({ id: instance.id, enabled: meta.enabled }, { onSuccess: () => onSaved?.() })
      return
    }
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
    toggle.reset()
  }

  const set = (key: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    save.reset()
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3" aria-label={label ?? `${manifest.name} settings`}>
      {managed && (
        <>
          <Input size="small" label="Name" disabled={declared} value={meta.name} onChange={(e) => setMetaField({ name: e.target.value })} />
          <div className="flex items-end gap-4">
            <Input size="small" label="Priority" type="number" className="w-24" disabled={declared} value={meta.priority} onChange={(e) => setMetaField({ priority: e.target.value })} />
            <Checkbox checked={meta.enabled} disabled={declared && !enabledOnly} onChange={(e) => setMetaField({ enabled: e.target.checked })}>
              Enabled
            </Checkbox>
          </div>
        </>
      )}
      <fieldset disabled={declared} className="contents">
        {manifest.fields.map((f) => (
          <Control
            key={f.key}
            field={f}
            instance={instance}
            value={values[f.key]}
            secret={secrets[f.key] ?? ''}
            live={options[f.key]}
            onValue={(v) => set(f.key, v)}
            onSecret={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))}
          />
        ))}
      </fieldset>

      {test.isError && (
        <Note variant="error" size="small">
          Could not run the test. Try again.
        </Note>
      )}
      {test.data &&
        (test.data.result.ok ? (
          <Note variant="success" size="small">
            Connected: {test.data.result.message}
          </Note>
        ) : (
          <Note variant="error" size="small">
            Test failed: {test.data.result.message}
          </Note>
        ))}
      {saving.isError && (
        <Note variant="error" size="small">
          {saving.error instanceof ApiError ? saving.error.message : 'Could not save. Try again.'}
        </Note>
      )}
      {saving.isSuccess && (
        <Note variant="success" size="small">
          Saved.
        </Note>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="small" disabled={test.isPending} onClick={runTest}>
          Test connection
        </Button>
        <Button size="small" variant="primary" typeName="submit" disabled={saving.isPending || (declared && !enabledOnly)}>
          Save
        </Button>
        {onCancel && (
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {instance && (
          <Button size="small" disabled={remove.isPending || declared} onClick={() => remove.mutate(instance.id)}>
            Remove
          </Button>
        )}
      </div>
      {declared && (
        <Note size="small">
          The Config File declares this instance, so it can be tested but not changed or removed here{enabledOnly ? ', except for switching it on or off' : ''}. Change the file and restart Kestrel
          instead.
        </Note>
      )}
    </form>
  )
}

function Control({
  field,
  instance,
  value,
  secret,
  live,
  onValue,
  onSecret,
}: {
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
        <Input
          size="small"
          label={field.label}
          type="password"
          autoComplete="off"
          value={secret}
          placeholder={isSet ? 'Saved. Leave blank to keep it.' : ''}
          onChange={(e) => onSecret(e.target.value)}
        />
      )
    }
    case 'bool':
      return (
        <Checkbox checked={value === true} onChange={(e) => onValue(e.target.checked)}>
          {field.label}
        </Checkbox>
      )
    case 'select':
      return <Select size="small" label={field.label} value={text} onChange={(e) => onValue(e.target.value)} options={field.options.map((o) => ({ value: o.value, label: o.label }))} />
    default:
      if (live) {
        const choices = live.some((o) => o.value === text) || text === '' ? live : [{ value: text, label: text }, ...live]
        return <Select size="small" label={field.label} value={text} onChange={(e) => onValue(e.target.value)} options={choices.map((o) => ({ value: o.value, label: o.label }))} />
      }
      return <Input size="small" label={field.label} type={field.type === 'int' ? 'number' : 'text'} value={text} onChange={(e) => onValue(e.target.value)} />
  }
}
