import { SingleInstance } from './SingleInstance'

/** The download client form, shared by the wizard and Settings. v1 runs exactly one enabled download client. */
export function DownloadClient() {
  return <SingleInstance contract="download_client.v1" noun="download client" />
}
