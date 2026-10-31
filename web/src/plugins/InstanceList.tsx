import { Badge, Button, Entity, Fieldset, Note, Select, Toggle } from '@hyprsh/design'
import { SkeletonRows } from '../loading'
import { useState } from 'react'
import { ApiError, usePluginInstances, usePlugins, useSetInstanceEnabled, type PluginInstance, type PluginManifest } from '../api/queries'
import { ago, useNow } from '../time'
import { useReport } from '../toasts'
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
  if (!plugins.data || !instances.data) return <SkeletonRows count={2} />

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
            <Entity.List aria-label={`${noun}s`}>
              {rows.map((i) => {
                const manifest = manifests.find((m) => m.id === i.plugin_id)
                return editing === i.id && manifest ? (
                  <Entity key={i.id}>
                    <div className="min-w-0 flex-1">
                      <InstanceForm manifest={manifest} instance={i} managed={managed} label={i.name} onSaved={done} onCancel={done} />
                    </div>
                  </Entity>
                ) : (
                  <Row key={i.id} instance={i} manifest={manifest} showPriority={showPriority} onEdit={() => setEditing(i.id)} />
                )
              })}
            </Entity.List>
          )}
          {editing === 'new' && newManifest && (
            <>
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
            </>
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
  const report = useReport()
  const declared = i.from_config_file
  // The Config File owns enabled only when it sets it (ADR 0015).
  const enabledLocked = i.enabled_declared
  const meta = [manifest?.name ?? i.plugin_id, showPriority ? `Priority ${i.priority}` : null].filter(Boolean).join(' · ')
  return (
    <Entity
      right={
        <>
          <Toggle
            aria-label={`${i.name} enabled`}
            checked={i.enabled}
            disabled={enabledLocked || toggle.isPending}
            onChange={(enabled) => void report(toggle.mutateAsync({ id: i.id, enabled }), { done: `${i.name} ${enabled ? 'enabled' : 'disabled'}` })}
          />
          <Button size="small" aria-label={`Edit ${i.name}`} disabled={!manifest} onClick={onEdit}>
            Edit
          </Button>
        </>
      }
    >
      <Entity.Content
        fill
        title={
          <>
            {i.name}
            {declared && (
              <>
                {' '}
                <Badge contrast="low" size="sm" title="Declared in the Config File">
                  Declared
                </Badge>
              </>
            )}
          </>
        }
        description={
          <>
            <span className="block truncate">{meta}</span>
            {i.last_check && <LastCheck check={i.last_check} />}
            {!manifest && <Note size="small">{i.name} uses a plugin that is no longer built into Kestrel.</Note>}
            {toggle.isError && (
              <Note variant="error" size="small">
                {toggle.error instanceof ApiError ? toggle.error.message : 'Could not save. Try again.'}
              </Note>
            )}
          </>
        }
      />
    </Entity>
  )
}

/** The latest check of the instance, under its row. It wraps rather than widens, so a long error fits a phone. */
function LastCheck({ check }: { check: NonNullable<PluginInstance['last_check']> }) {
  const when = ago(check.at, useNow())
  const text = check.ok ? `Checked ${when}: OK` : `Check failed ${when}: ${check.message || check.code || 'unknown error'}`
  return <div className={`label-12 min-w-0 whitespace-normal break-words ${check.ok ? 'text-gray-900' : 'text-red-900'}`}>{text}</div>
}
