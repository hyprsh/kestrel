import { Note, Select } from '@hyprsh/design'
import { SkeletonForm } from '../loading'
import { useState } from 'react'
import { usePluginInstances, usePlugins } from '../api/queries'
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

  if (plugins.isError || instances.isError)
    return (
      <Note variant="error" size="small">
        Could not load the {noun} settings.
      </Note>
    )
  if (!plugins.data || !instances.data) return <SkeletonForm rows={3} />

  const manifests = plugins.data.filter((m) => m.contract === contract)
  const current = instances.data.find((i) => i.contract === contract && i.enabled) ?? instances.data.find((i) => i.contract === contract)
  const manifest = manifests.find((m) => m.id === (current?.plugin_id ?? picked)) ?? manifests[0]
  if (!manifest) return <Note size="small">No {noun} is built into this Kestrel.</Note>

  return (
    <div className="flex flex-col gap-3">
      {manifests.length > 1 && !current && (
        <Select
          size="small"
          label={noun.charAt(0).toUpperCase() + noun.slice(1)}
          wrapperClassName="max-w-md"
          value={manifest.id}
          onChange={(e) => setPicked(e.target.value)}
          options={manifests.map((m) => ({ value: m.id, label: m.name }))}
        />
      )}
      {/* Keyed by adapter only: saving keeps the form in place. */}
      <InstanceForm key={manifest.id} manifest={manifest} instance={current} />
    </div>
  )
}
