import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
import { Field, Select } from '../forms'
import { InstanceForm } from './InstanceForm'

/**
 * The form for a contract of which Kestrel uses one instance (the wizard's
 * download client and indexer, Settings' download client): it edits that one, or
 * sets it up, and lets the admin pick the adapter when more than one is built in.
 */
export function SingleInstance({ contract, noun }: { contract: string; noun: string }) {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const [picked, setPicked] = useState<string>()

  if (plugins.isError || instances.isError) return <p className="text-[12px] text-red-900">Could not load the {noun} settings.</p>
  if (!plugins.data || !instances.data) return null

  const manifests = plugins.data.filter((m) => m.contract === contract)
  const current = instances.data.find((i) => i.contract === contract && i.enabled) ?? instances.data.find((i) => i.contract === contract)
  const manifest = manifests.find((m) => m.id === (current?.plugin_id ?? picked)) ?? manifests[0]
  if (!manifest) return <p className="text-gray-900">No {noun} is built into this Kestrel.</p>

  return (
    <div className="flex flex-col gap-3">
      {manifests.length > 1 && !current && (
        <div className="max-w-md">
          <Field label={noun.charAt(0).toUpperCase() + noun.slice(1)}>
            {(id) => (
              <Select id={id} value={manifest.id} onChange={(e) => setPicked(e.target.value)}>
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
      {/* Keyed by adapter only: saving keeps the form (and its "Saved." note) in place. */}
      <InstanceForm key={manifest.id} manifest={manifest} instance={current} />
    </div>
  )
}
