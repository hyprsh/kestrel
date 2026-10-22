import { Button, Fieldset, Note, Select } from '@hyprsh/design'
import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
import { InstanceForm } from './InstanceForm'

const CONTRACT = 'media_server.v1'

/**
 * Settings' media-server list: Silo, Jellyfin and Plex instances, each its own
 * form (name, enabled, the manifest's fields), plus Add media server. Every
 * enabled one is told to refresh a Title folder after each change.
 */
export function MediaServers() {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string>()

  if (plugins.isError || instances.isError)
    return (
      <Note variant="error" size="small">
        Could not load the media servers.
      </Note>
    )
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === CONTRACT)
  const servers = instances.data.filter((i) => i.contract === CONTRACT)
  const newManifest = manifests.find((m) => m.id === picked) ?? manifests[0]

  return (
    <div className="flex flex-col gap-4">
      {servers.length === 0 && !adding && <Note size="small">No media servers yet. Without one, new files show up only after the server's own library scan.</Note>}
      {servers.map((i) => {
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
                    label="Media server type"
                    wrapperClassName="max-w-md"
                    value={newManifest.id}
                    onChange={(e) => setPicked(e.target.value)}
                    options={manifests.map((m) => ({ value: m.id, label: m.name }))}
                  />
                )}
                <InstanceForm key={newManifest.id} manifest={newManifest} managed label="New media server" onSaved={() => setAdding(false)} />
                <Button size="small" className="self-start" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </Fieldset.Content>
          </Fieldset>
        ) : (
          <Button size="small" disabled={!newManifest} onClick={() => setAdding(true)}>
            Add media server
          </Button>
        )}
      </div>
    </div>
  )
}
