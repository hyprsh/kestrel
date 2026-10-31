import { useQueue } from '../api/queue'
import { useCancel } from '../grabs/useCancel'
import { RowList } from '../layout/RowList'
import { DownloadRow } from '../grabs/DownloadRow'

/**
 * The Title page's "Downloading": this Title's active Grabs, drawn as in the
 * Overview's Downloading now and kept live by the same `queue` frames. The
 * queue is filtered here, by `title_id`; nothing shows when none is active.
 */
export function TitleDownloads({ titleId }: { titleId: number }) {
  const cancel = useCancel()
  const items = (useQueue().data ?? []).filter((i) => i.title_id === titleId)
  if (items.length === 0) return null
  return (
    <section aria-labelledby="title-downloading" className="mt-6">
      <h3 id="title-downloading" className="heading-14 mb-2">
        Downloading
      </h3>
      <RowList aria-labelledby="title-downloading">
        {items.map((i) => (
          <DownloadRow key={i.grab_id} item={i} withTitle={false} busy={cancel.pending} onCancel={(blocklist) => void cancel.run(i.grab_id, blocklist)} />
        ))}
      </RowList>
    </section>
  )
}
