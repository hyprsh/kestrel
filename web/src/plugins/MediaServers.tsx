import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
import { Button, Field, Select } from '../forms'
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

  if (plugins.isError || instances.isError) return <p className="p-4 text-[12px] text-red-900">Could not load the media servers.</p>
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === CONTRACT)
  const servers = instances.data.filter((i) => i.contract === CONTRACT)
  const newManifest = manifests.find((m) => m.id === picked) ?? manifests[0]

  return (
    <div className="flex flex-col divide-y divide-gray-alpha-400">
      {servers.length === 0 && !adding && (
        <p className="p-4 text-gray-900">No media servers yet. Without one, new files show up only after the server's own library scan.</p>
      )}
      {servers.map((i) => {
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
                <Field label="Media server type">
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
            <InstanceForm key={newManifest.id} manifest={newManifest} managed label="New media server" onSaved={() => setAdding(false)} />
            <Button variant="secondary" className="self-start" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" disabled={!newManifest} onClick={() => setAdding(true)}>
            Add media server
          </Button>
        )}
      </div>
    </div>
  )
}
