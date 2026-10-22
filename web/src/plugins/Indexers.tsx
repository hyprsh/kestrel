import { Button, Fieldset, Note, Select } from '@hyprsh/design'
import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
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

  if (plugins.isError || instances.isError)
    return (
      <Note variant="error" size="small">
        Could not load the indexers.
      </Note>
    )
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === CONTRACT)
  const indexers = instances.data.filter((i) => i.contract === CONTRACT)
  const newManifest = manifests.find((m) => m.id === picked) ?? manifests[0]

  return (
    <div className="flex flex-col gap-4">
      {indexers.length === 0 && !adding && <Note size="small">No indexers yet. Kestrel cannot search for releases without one.</Note>}
      {indexers.map((i) => {
        const manifest = manifests.find((m) => m.id === i.plugin_id)
        return (
          <Fieldset key={i.id}>
            <Fieldset.Content>
              {manifest ? <InstanceForm manifest={manifest} instance={i} managed label={i.name} /> : <Note size="small">{i.name} uses a plugin that is no longer built into Kestrel.</Note>}
            </Fieldset.Content>
          </Fieldset>
        )
      })}
      <div>
        {adding && newManifest ? (
          <Fieldset>
            <Fieldset.Content>
              <div className="flex flex-col gap-3">
                {manifests.length > 1 && (
                  <Select
                    size="small"
                    label="Indexer type"
                    wrapperClassName="max-w-md"
                    value={newManifest.id}
                    onChange={(e) => setPicked(e.target.value)}
                    options={manifests.map((m) => ({ value: m.id, label: m.name }))}
                  />
                )}
                <InstanceForm key={newManifest.id} manifest={newManifest} managed label="New indexer" onSaved={() => setAdding(false)} />
                <Button size="small" className="self-start" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </Fieldset.Content>
          </Fieldset>
        ) : (
          <Button size="small" disabled={!newManifest} onClick={() => setAdding(true)}>
            Add indexer
          </Button>
        )}
      </div>
    </div>
  )
}
