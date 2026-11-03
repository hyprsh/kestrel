import { Button, Description, Note, Sheet } from '@hyprsh/design'
import { useState } from 'react'
import { useDownloadsStatus, useTestInstance } from '../api/downloads'
import { usePluginInstances, usePlugins, type PluginInstance } from '../api/queries'
import { DescriptionGrid, SettingsBlock, SettingsSection, StatusLine } from '../layout/SettingsPage'
import { SkeletonRows } from '../loading'
import { ago, useNow } from '../time'
import { useReport } from '../toasts'
import { InstanceForm } from './InstanceForm'

const contract = 'download_client.v1'

/** Free space as the card shows it: "1.1 TB", "340 GB". */
function freeSpace(bytes: number): string {
  const tb = bytes / 1024 ** 4
  return tb >= 1 ? `${tb.toFixed(1)} TB` : `${Math.max(0, Math.round(bytes / 1024 ** 3))} GB`
}

const queueText = (downloading: number, queued: number) => {
  if (downloading === 0 && queued === 0) return 'Idle'
  return [downloading > 0 ? `${downloading} downloading` : null, queued > 0 ? `${queued} waiting` : null].filter(Boolean).join(', ')
}

/**
 * Settings' download client: one card with its name, whether it answers (version, how long ago it was checked, or the
 * error), Test and Edit…, and a strip with its address, category, queue and free space. v1 runs exactly one enabled client.
 */
export function DownloadClientSection() {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const live = useDownloadsStatus()
  const test = useTestInstance()
  const report = useReport()
  const now = useNow()
  const [editing, setEditing] = useState(false)

  const section = (body: React.ReactNode, action?: React.ReactNode) => (
    <SettingsSection title="Download client" action={action}>
      {body}
    </SettingsSection>
  )
  if (plugins.isError || instances.isError)
    return section(
      <Note variant="error" size="small">
        Could not load the download client.
      </Note>,
    )
  if (!plugins.data || !instances.data) return section(<SkeletonRows count={1} />)

  const manifests = plugins.data.filter((m) => m.contract === contract)
  const rows = instances.data.filter((i) => i.contract === contract)
  const current: PluginInstance | undefined = rows.find((i) => i.enabled) ?? rows[0]
  const manifest = manifests.find((m) => m.id === (current?.plugin_id ?? manifests[0]?.id))
  const sheet = manifest && (
    <Sheet open={editing} onOpenChange={setEditing} modal>
      <Sheet.Content side="right" aria-label={current ? `Edit ${current.name}` : 'Add a download client'}>
        <Sheet.Header>
          <Sheet.Title>{current ? current.name : 'Add a download client'}</Sheet.Title>
          <Sheet.Description>Where Kestrel sends NZBs and reads their progress. Test the connection to pick the categories from the client&apos;s own list.</Sheet.Description>
        </Sheet.Header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <InstanceForm
            key={current?.id ?? 'new'}
            manifest={manifest}
            instance={current}
            label={current ? current.name : 'New download client'}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      </Sheet.Content>
    </Sheet>
  )

  if (!current)
    return section(
      <SettingsBlock>
        <Note size="small">No download client yet. Kestrel cannot send anything to be downloaded without one.</Note>
        <Button size="small" className="self-start" disabled={!manifest} onClick={() => setEditing(true)}>
          Add download client…
        </Button>
        {sheet}
      </SettingsBlock>,
    )

  const status = live.data?.download_client?.instance_id === current.id ? live.data.download_client : undefined
  const check = current.last_check
  let line: React.ReactNode
  if (status?.state === 'ok')
    line = (
      <StatusLine state="success">
        Connected{status.version ? ` · version ${status.version}` : ''} · checked {ago(status.checked_at, now)}
      </StatusLine>
    )
  else if (status?.state === 'failing')
    line = (
      <StatusLine state="error" tone="problem">
        Failing · {status.message || 'no answer'}
      </StatusLine>
    )
  else if (!current.enabled)
    line = (
      <StatusLine state="neutral" tone="muted">
        Off
      </StatusLine>
    )
  else if (check && !live.isPending)
    line = check.ok ? (
      <StatusLine state="success">Connected · checked {ago(check.at, now)}</StatusLine>
    ) : (
      <StatusLine state="error" tone="problem">
        Failing · {check.message || check.code || 'no answer'}
      </StatusLine>
    )
  else
    line = (
      <StatusLine state="pending" tone="muted">
        Checking…
      </StatusLine>
    )

  const category = [current.config.movie_category, current.config.tv_category].filter((c): c is string => typeof c === 'string' && c !== '')
  const address = typeof current.config.url === 'string' ? current.config.url.replace(/^https?:\/\//, '') : ''
  return section(
    <SettingsBlock>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span className="label-16 font-semibold">{current.name}</span>
          {line}
        </div>
        <div className="flex gap-2">
          <Button
            size="small"
            variant="secondary"
            loading={test.isPending}
            onClick={() =>
              void report(test.mutateAsync(current.id), {
                done: (r) => (r.ok ? `${current.name}: ${r.message || 'connected'}` : `${current.name} failed: ${r.message}`),
                warn: (r) => !r.ok,
                failed: `Could not test ${current.name}`,
              })
            }
          >
            Test
          </Button>
          <Button size="small" variant="secondary" disabled={!manifest} onClick={() => setEditing(true)}>
            Edit…
          </Button>
        </div>
      </div>
      <DescriptionGrid>
        <Description title="Address" ellipsis content={<span className="label-13-mono">{address || 'Not set'}</span>} />
        <Description title="Category" ellipsis content={category.length > 0 ? category.join(' · ') : 'Not set'} />
        <Description title="Queue" ellipsis content={status?.state === 'ok' && status.downloading !== null && status.queued !== null ? queueText(status.downloading, status.queued) : 'Unknown'} />
        <Description title="Free space" ellipsis content={status?.state === 'ok' && status.free_bytes !== null ? freeSpace(status.free_bytes) : 'Unknown'} />
      </DescriptionGrid>
      {sheet}
    </SettingsBlock>,
  )
}
