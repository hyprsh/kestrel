import { useCancelGrab, useQueue } from '../api/queue'
import { Note } from '@hyprsh/design'
import { DownloadRow } from '../grabs/DownloadRow'

/**
 * The Title page's "Downloading": this Title's active Grabs, drawn as in the
 * Overview's Downloading now and kept live by the same `queue` frames. The
 * queue is filtered here, by `title_id`; nothing shows when none is active.
 */
export function TitleDownloads({ titleId }: { titleId: number }) {
  const cancel = useCancelGrab()
  const items = (useQueue().data ?? []).filter((i) => i.title_id === titleId)
  if (items.length === 0) return null
  return (
    <section aria-labelledby="title-downloading" className="mt-6">
      <h3 id="title-downloading" className="heading-14 mb-2">
        Downloading
      </h3>
      {cancel.isError && (
        <div className="mb-2">
          <Note variant="error" size="small">
            {cancel.error.message}
          </Note>
        </div>
      )}
      <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
        {items.map((i) => (
          <DownloadRow key={i.grab_id} item={i} withTitle={false} busy={cancel.isPending} onCancel={(blocklist) => cancel.mutate({ id: i.grab_id, blocklist })} />
        ))}
      </ul>
    </section>
  )
}
