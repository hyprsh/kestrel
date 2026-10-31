// A Blocking Needs attention row stops Kestrel working everywhere, so every screen says so.
// One banner at a time: the first Blocking row, its first action as the call to action.
import { Button, ProjectBanner, useToasts } from '@hyprsh/design'
import { useAttention } from '../api/attention'
import { useAttentionAction } from '../overview/useAttentionAction'

export function BlockingBanner({ onOpen }: { onOpen: (path: string) => void }) {
  const toasts = useToasts()
  const { act, pending, dialog } = useAttentionAction(onOpen, toasts.error)
  const blocking = (useAttention().data?.rows ?? []).filter((r) => r.severity === 'blocking')
  const [row] = blocking
  if (!row) return null
  const [first] = row.actions
  const more = blocking.length - 1
  const label = (
    <>
      {row.message}
      {more > 0 && (
        <>
          {' '}
          <Button variant="tertiary" size="small" onClick={() => onOpen('/overview')}>
            and {more} more
          </Button>
        </>
      )}
    </>
  )
  return (
    <>
      <ProjectBanner variant="error" label={label} callToAction={first && { label: first.label, onClick: pending ? () => {} : () => act(first) }} />
      {dialog}
    </>
  )
}
