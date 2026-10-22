import { InstanceList } from './InstanceList'
import { SingleInstance } from './SingleInstance'

/** The download client form, shared by the wizard and Settings. v1 runs exactly one enabled download client. */
export function DownloadClient() {
  return <SingleInstance contract="download_client.v1" noun="download client" />
}

/** Settings' download client: one compact row, its connection form opening inline for Edit (or Add, while there is none). */
export function DownloadClientRow() {
  return (
    <InstanceList
      contract="download_client.v1"
      noun="download client"
      addLabel="Add download client"
      newLabel="New download client"
      typeLabel="Download client type"
      empty="No download client yet. Kestrel cannot send anything to be downloaded without one."
      title="Connection"
      help="Where Kestrel sends NZBs and reads their progress. Test the connection to pick the categories from SABnzbd's own list."
      single
    />
  )
}
