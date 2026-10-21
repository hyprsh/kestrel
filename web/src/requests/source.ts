// A Request's source as people read it, wherever a Request is shown: the Overview's Recent requests,
// the Requests screen and a Title's "Requested by". The server writes the Log's line by the same rule
// (requests.SourceName), so all of them say "via Silo".

/** "Silo" for the source "silo", "Jellyseerr" for "jellyseerr". */
export const sourceName = (source: string) => source.charAt(0).toUpperCase() + source.slice(1)
