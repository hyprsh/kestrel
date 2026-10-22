import { InstanceList } from './InstanceList'

/**
 * Settings' media-server list: Silo, Jellyfin and Plex instances as compact rows,
 * with the full form (name, enabled, the manifest's fields) opening inline for Edit
 * or Add media server. Every enabled one is told to refresh a Title folder after each change.
 */
export function MediaServers() {
  return (
    <InstanceList
      contract="media_server.v1"
      noun="media server"
      addLabel="Add media server"
      newLabel="New media server"
      typeLabel="Media server type"
      empty="No media servers yet. Without one, new files show up only after the server's own library scan."
      managed
    />
  )
}
