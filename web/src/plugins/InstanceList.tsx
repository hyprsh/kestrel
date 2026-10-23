import { Badge, Button, Fieldset, Note, Select, Toggle } from '@hyprsh/design'
import { useState, type ReactNode } from 'react'
import { ApiError, usePluginInstances, usePlugins, useSetInstanceEnabled, type PluginInstance, type PluginManifest } from '../api/queries'
import { ago, useNow } from '../time'
import { InstanceForm } from './InstanceForm'

/**
 * Settings' list of the plugin instances of one contract: one compact row each
 * (name, plugin type, priority, enabled switch, "declared" marker), and the full
 * InstanceForm opens inline in the row's place only for Edit, or at the end for Add.
 */
export function InstanceList({
  contract,
  noun,
  addLabel,
  newLabel,
  typeLabel,
  empty,
  title,
  help,
  showPriority,
  single,
  managed,
}: {
  contract: string
  /** "indexer", "media server": for the load error. */
  noun: string
  addLabel: string
  /** The accessible name of the form that adds one. */
  newLabel: string
  typeLabel: string
  empty: string
  title?: string
  help?: string
  /** Shows each instance's priority and sorts by it, lowest (tried first) on top. */
  showPriority?: boolean
  /** Offers Add only while there is no instance (the download client: v1 runs one). */
  single?: boolean
  /** Forms carry Name, Enabled and Priority. */
  managed?: boolean
}) {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [picked, setPicked] = useState<string>()

  if (plugins.isError || instances.isError)
    return (
      <Note variant="error" size="small">
        Could not load the {noun}s.
      </Note>
    )
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === contract)
  const rows = instances.data.filter((i) => i.contract === contract)
  if (showPriority) rows.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id - b.id)
  const newManifest = manifests.find((m) => m.id === picked) ?? manifests[0]
  const done = () => setEditing(null)

  return (
    <Fieldset>
      <Fieldset.Content>
        {title && <Fieldset.Title as="h3">{title}</Fieldset.Title>}
        {help && <Fieldset.Subtitle>{help}</Fieldset.Subtitle>}
        <div className="flex flex-col gap-3">
          {rows.length === 0 && editing !== 'new' && <Note size="small">{empty}</Note>}
          {rows.length > 0 && (
            <ul className="flex flex-col divide-y divide-gray-alpha-400 rounded-md border border-gray-alpha-400">
              {rows.map((i) => {
                const manifest = manifests.find((m) => m.id === i.plugin_id)
                return (
                  <li key={i.id} className="px-3 py-2">
                    {editing === i.id && manifest ? (
                      <InstanceForm manifest={manifest} instance={i} managed={managed} label={i.name} onSaved={done} onCancel={done} />
                    ) : (
                      <Row instance={i} manifest={manifest} showPriority={showPriority} onEdit={() => setEditing(i.id)} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {editing === 'new' && newManifest && (
            <div className="flex flex-col gap-3 rounded-md border border-gray-alpha-400 px-3 py-2">
              {manifests.length > 1 && (
                <Select
                  size="small"
                  label={typeLabel}
                  wrapperClassName="max-w-md"
                  value={newManifest.id}
                  onChange={(e) => setPicked(e.target.value)}
                  options={manifests.map((m) => ({ value: m.id, label: m.name }))}
                />
              )}
              <InstanceForm key={newManifest.id} manifest={newManifest} managed={managed} label={newLabel} onSaved={done} onCancel={done} />
            </div>
          )}
          {editing !== 'new' && !(single && rows.length > 0) && (
            <Button size="small" className="self-start" disabled={!newManifest} onClick={() => setEditing('new')}>
              {addLabel}
            </Button>
          )}
        </div>
      </Fieldset.Content>
    </Fieldset>
  )
}

function Row({ instance: i, manifest, showPriority, onEdit }: { instance: PluginInstance; manifest?: PluginManifest; showPriority?: boolean; onEdit: () => void }) {
  const toggle = useSetInstanceEnabled()
  const declared = i.from_config_file
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="label-14 min-w-0 truncate text-gray-1000">{i.name}</span>
          <Meta>{manifest?.name ?? i.plugin_id}</Meta>
          {showPriority && <Meta>Priority {i.priority}</Meta>}
          {declared && (
            <Badge variant="gray-subtle" size="sm" title="Declared in the Config File">
              Declared
            </Badge>
          )}
        </div>
        <Toggle aria-label={`${i.name} enabled`} checked={i.enabled} disabled={declared || toggle.isPending} onChange={(enabled) => toggle.mutate({ id: i.id, enabled })} />
        <Button size="small" aria-label={`Edit ${i.name}`} disabled={!manifest} onClick={onEdit}>
          Edit
        </Button>
      </div>
      {i.last_check && <LastCheck check={i.last_check} />}
      {!manifest && <Note size="small">{i.name} uses a plugin that is no longer built into Kestrel.</Note>}
      {toggle.isError && (
        <Note variant="error" size="small">
          {toggle.error instanceof ApiError ? toggle.error.message : 'Could not save. Try again.'}
        </Note>
      )}
    </div>
  )
}

/** The latest check of the instance, under its row. It wraps rather than widens, so a long error fits a phone. */
function LastCheck({ check }: { check: NonNullable<PluginInstance['last_check']> }) {
  const when = ago(check.at, useNow())
  const text = check.ok ? `Checked ${when}: OK` : `Check failed ${when}: ${check.message || check.code || 'unknown error'}`
  return <div className={`label-12 min-w-0 break-words ${check.ok ? 'text-gray-900' : 'text-red-900'}`}>{text}</div>
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="copy-13 text-gray-900">{children}</span>
}
