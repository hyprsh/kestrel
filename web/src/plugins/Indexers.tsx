import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
import { Button, Field, Select } from '../forms'
import { InstanceForm } from './InstanceForm'

const CONTRACT = 'indexer.v1'

/**
 * Settings' indexer list: every indexer as its own form (name, priority, enabled,
 * the manifest's fields), plus Add indexer. Lower priority numbers are tried first.
 */
export function Indexers() {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string>()

  if (plugins.isError || instances.isError) return <p className="p-4 text-[12px] text-red-900">Could not load the indexers.</p>
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === CONTRACT)
  const indexers = instances.data.filter((i) => i.contract === CONTRACT)
  const newManifest = manifests.find((m) => m.id === picked) ?? manifests[0]

  return (
    <div className="flex flex-col divide-y divide-gray-alpha-400">
      {indexers.length === 0 && !adding && <p className="p-4 text-gray-900">No indexers yet. Kestrel cannot search for releases without one.</p>}
      {indexers.map((i) => {
        const manifest = manifests.find((m) => m.id === i.plugin_id)
        return (
          <div key={i.id} className="p-4">
            {manifest ? (
              <InstanceForm manifest={manifest} instance={i} managed label={i.name} />
            ) : (
              <p className="text-gray-900">{i.name} uses a plugin that is no longer built into Kestrel.</p>
            )}
          </div>
        )
      })}
      <div className="p-4">
        {adding && newManifest ? (
          <div className="flex flex-col gap-3">
            {manifests.length > 1 && (
              <div className="max-w-md">
                <Field label="Indexer type">
                  {(id) => (
                    <Select id={id} value={newManifest.id} onChange={(e) => setPicked(e.target.value)}>
                      {manifests.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <InstanceForm key={newManifest.id} manifest={newManifest} managed label="New indexer" onSaved={() => setAdding(false)} />
            <Button variant="secondary" className="self-start" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" disabled={!newManifest} onClick={() => setAdding(true)}>
            Add indexer
          </Button>
        )}
      </div>
    </div>
  )
}
