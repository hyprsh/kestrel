import { Button, DestructiveActionModal, DotsMenu, MenuItem, Note, Select, Sheet, Toggle } from '@hyprsh/design'
import { GripVertical } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useStatus } from '../api/attention'
import { useDownloadsStatus, useReorderInstances, useTestInstance } from '../api/downloads'
import { useDeletePluginInstance, usePluginInstances, usePlugins, useSetInstanceEnabled, type PluginInstance, type PluginManifest } from '../api/queries'
import { IndexerHead, IndexerLine } from '../layout/SettingsLists'
import { SettingsCard, SettingsSection, StatusLine } from '../layout/SettingsPage'
import { SkeletonRows } from '../loading'
import { plural } from '../format'
import { useReport } from '../toasts'
import { InstanceForm } from './InstanceForm'

const contract = 'indexer.v1'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** The row's status: Off, Failing with why, or OK with the median time its searches take (else how long the last Test took). */
function IndexerStatus({ instance, failing, latency }: { instance: PluginInstance; failing: string | null; latency: number | null }) {
  if (!instance.enabled)
    return (
      <StatusLine state="neutral" tone="muted">
        Off
      </StatusLine>
    )
  if (failing !== null)
    return (
      <StatusLine state="error" tone="problem">
        Failing · {failing}
      </StatusLine>
    )
  if (!instance.last_check)
    return (
      <StatusLine state="neutral" tone="muted">
        Not asked yet
      </StatusLine>
    )
  return <StatusLine state="success">{latency ? `OK · ${seconds(latency)}` : 'OK'}</StatusLine>
}

/**
 * Settings' indexers: a list in the order Kestrel asks them (the top one first; an automatic search asks the next priority
 * only for what the earlier ones left), each with its health, its Grabs of the
 * last 30 days, an on/off switch and a menu. A row's drag handle (or the arrow keys on it) changes the order, which is saved
 * as the instances' priorities. Edit and Add open the full form in a side sheet.
 */
export function IndexerSection() {
  const plugins = usePlugins()
  const instances = usePluginInstances()
  const status = useStatus()
  const live = useDownloadsStatus()
  const toggle = useSetInstanceEnabled()
  const test = useTestInstance()
  const reorder = useReorderInstances()
  const remove = useDeletePluginInstance()
  const report = useReport()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [removing, setRemoving] = useState<PluginInstance | null>(null)
  const [picked, setPicked] = useState<string>()
  const [order, setOrder] = useState<number[] | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  if (plugins.isError || instances.isError)
    return (
      <SettingsSection title="Indexers">
        <Note variant="error" size="small">
          Could not load the indexers.
        </Note>
      </SettingsSection>
    )
  if (!plugins.data || !instances.data)
    return (
      <SettingsSection title="Indexers">
        <SkeletonRows count={2} />
      </SettingsSection>
    )

  const manifests = plugins.data.filter((m) => m.contract === contract)
  const sorted = instances.data.filter((i) => i.contract === contract).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id - b.id)
  const rows = order ? [...sorted].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : sorted
  // The Config File owns a declared instance's priority, so no order can be set while there is one.
  const fixed = rows.some((r) => r.from_config_file)
  const health = new Map((status.data?.indexers ?? []).map((i) => [i.instance_id, i]))
  const grabs = new Map((live.data?.indexers ?? []).map((i) => [i.instance_id, i.grabs_30d]))
  const editingRow = typeof editing === 'number' ? rows.find((r) => r.id === editing) : undefined
  const newManifest: PluginManifest | undefined = manifests.find((m) => m.id === picked) ?? manifests[0]
  const formManifest = editingRow ? manifests.find((m) => m.id === editingRow.plugin_id) : newManifest
  const close = () => setEditing(null)

  const move = (from: number, to: number) => {
    if (fixed || to < 0 || to >= rows.length || from === to) return
    const ids = rows.map((r) => r.id)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setOrder(ids)
    const changes = ids.map((id, i) => ({ id, priority: i + 1 })).filter((c) => sorted.find((r) => r.id === c.id)!.priority !== c.priority)
    void report(reorder.mutateAsync(changes), { failed: 'Could not save the order' }).finally(() => setOrder(null))
  }
  const onHandleKey = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp') move(index, index - 1)
    else if (e.key === 'ArrowDown') move(index, index + 1)
    else return
    e.preventDefault()
  }
  const testAll = () => {
    const targets = rows.filter((r) => r.enabled)
    return report(Promise.all(targets.map((r) => test.mutateAsync(r.id))), {
      done: (rs) => {
        const bad = rs.filter((r) => !r.ok).length
        return bad === 0 ? `All ${plural(rs.length, 'indexer')} answered` : `${bad} of ${plural(rs.length, 'indexer')} failed`
      },
      warn: (rs) => rs.some((r) => !r.ok),
      failed: 'Could not test the indexers',
    })
  }

  return (
    <SettingsSection
      title="Indexers"
      count={rows.length}
      action={
        <>
          <Button size="small" variant="secondary" disabled={rows.every((r) => !r.enabled)} loading={test.isPending} onClick={() => void testAll()}>
            Test All
          </Button>
          <Button size="small" disabled={!newManifest} onClick={() => setEditing('new')}>
            Add Indexer…
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <Note size="small">No indexers yet. Kestrel cannot search for releases without one.</Note>
      ) : (
        <>
          <SettingsCard>
            <IndexerHead />
            {rows.map((i, index) => {
              const h = health.get(i.id)
              const failing = h?.state === 'failing' ? h.message || 'no answer' : i.last_check && !i.last_check.ok ? i.last_check.message || i.last_check.code || 'no answer' : null
              const n = grabs.get(i.id)
              const declared = i.enabled_declared
              return (
                <div key={i.id} role="group" aria-label={i.name}>
                  <IndexerLine
                    failing={i.enabled && failing !== null}
                    dragging={dragging === i.id}
                    draggable={!fixed}
                    onDragStart={(e) => {
                      setDragging(i.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(i.id))
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => dragging !== null && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragging !== null)
                        move(
                          rows.findIndex((r) => r.id === dragging),
                          index,
                        )
                      setDragging(null)
                    }}
                    handle={
                      <Button
                        svgOnly
                        variant="tertiary"
                        size="tiny"
                        disabled={fixed}
                        aria-label={`Change the priority of ${i.name}`}
                        title={fixed ? 'The Config File sets the order' : 'Drag to change the priority, or press the up and down arrow keys'}
                        onKeyDown={(e) => onHandleKey(e, index)}
                      >
                        <GripVertical />
                      </Button>
                    }
                    name={i.name}
                    address={typeof i.config.url === 'string' ? i.config.url.replace(/^https?:\/\//, '') : ''}
                    status={<IndexerStatus instance={i} failing={failing} latency={health.get(i.id)?.median_ms ?? i.last_check?.latency_ms ?? null} />}
                    grabs={n === undefined ? '' : plural(n, 'Grab')}
                    toggle={
                      <Toggle
                        aria-label={`${i.name} enabled`}
                        checked={i.enabled}
                        disabled={declared || toggle.isPending}
                        onChange={(enabled) => void report(toggle.mutateAsync({ id: i.id, enabled }), { done: `${i.name} ${enabled ? 'enabled' : 'disabled'}`, failed: `Could not change ${i.name}` })}
                      />
                    }
                    menu={
                      <DotsMenu aria-label={`${i.name} actions`} size="tiny">
                        <MenuItem onClick={() => setEditing(i.id)} disabled={!manifests.some((m) => m.id === i.plugin_id)}>
                          Edit…
                        </MenuItem>
                        <MenuItem
                          onClick={() =>
                            void report(test.mutateAsync(i.id), {
                              done: (r) => (r.ok ? `${i.name}: ${r.message || 'OK'}` : `${i.name} failed: ${r.message}`),
                              warn: (r) => !r.ok,
                              failed: `Could not test ${i.name}`,
                            })
                          }
                        >
                          Test
                        </MenuItem>
                        <MenuItem type="error" disabled={i.from_config_file} description={i.from_config_file ? 'The Config File declares it' : undefined} onClick={() => setRemoving(i)}>
                          Remove…
                        </MenuItem>
                      </DotsMenu>
                    }
                  />
                </div>
              )
            })}
          </SettingsCard>
          <span className="label-12 text-gray-900">
            {fixed ? 'Kestrel asks indexers from top to bottom. The Config File sets the order.' : 'Kestrel asks indexers from top to bottom. Drag to reorder.'}
          </span>
        </>
      )}

      <Sheet open={editing !== null && !!formManifest} onOpenChange={(o) => !o && close()} modal>
        <Sheet.Content side="right" aria-label={editingRow ? `Edit ${editingRow.name}` : 'Add an indexer'}>
          <Sheet.Header>
            <Sheet.Title>{editingRow ? editingRow.name : 'Add an indexer'}</Sheet.Title>
          </Sheet.Header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3">
            {editing === 'new' && manifests.length > 1 && (
              <Select size="small" label="Indexer type" value={newManifest?.id} onChange={(e) => setPicked(e.target.value)} options={manifests.map((m) => ({ value: m.id, label: m.name }))} />
            )}
            {formManifest && (
              <InstanceForm
                key={`${editing}-${formManifest.id}`}
                manifest={formManifest}
                instance={editingRow}
                managed
                priorityHint="Indexers with the same priority are asked together, lowest first, and the next priority only for what the earlier ones left."
                label={editingRow ? editingRow.name : 'New indexer'}
                onSaved={close}
                onCancel={close}
              />
            )}
          </div>
        </Sheet.Content>
      </Sheet>
      <DestructiveActionModal
        open={removing !== null}
        title="Remove Indexer"
        description={removing ? `Kestrel stops asking ${removing.name} for releases. Grabs already made from it stay in Activity.` : undefined}
        confirmLabel="Remove Indexer"
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const gone = removing
          if (!gone) return
          void report(remove.mutateAsync(gone.id), { done: `${gone.name} removed`, failed: `Could not remove ${gone.name}` }).then(() => setRemoving(null))
        }}
      />
    </SettingsSection>
  )
}
