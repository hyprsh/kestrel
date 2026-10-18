# Placeholder Episodes before TheTVDB lists them

New episodes often reach indexers before TheTVDB lists them, and by the time it does the Release may have left RSS. So Kestrel adds a Placeholder Episode, by season and number only, when a Release names an unlisted episode of a monitored Series, instead of waiting for TheTVDB as the sole source of episodes (ADR 0002). Only a season TheTVDB already lists qualifies, and only an episode number at most 2 past the last episode TheTVDB lists in it. A Placeholder Episode counts as released from the moment it is added, and the next metadata refresh adopts it by season and number.

## Considered Options

- **Wait for TheTVDB.** Rejected because the Release has often left RSS by then, and a late search is a slower and costlier way to get the same file.
- **No limit past the last listed episode.** Rejected because a bad parse, such as a year or an absolute number read as an episode, would file a wrong episode into the library.
- **Measuring the limit from Placeholder Episodes as well.** Rejected because a chain of them, or of bad parses, could then extend the limit without end.

## Consequences

- A Placeholder Episode is created when a Release for it is Grabbed (from RSS or by hand) or when Import finds a file for it, so every Grab can name the episodes it covers.
- A manual Grab beyond the limit is an overridable rejection. A season TheTVDB does not list is a rejection that cannot be overridden.
- When TheTVDB moves a listed episode onto a Placeholder Episode's number, the listed episode wins: it takes over the placeholder's files where it has none, any conflicting file is left on disk as an Unmanaged file, and the placeholder is removed.
- A refresh removes a Placeholder Episode that holds no file and has no active Grab, so a bad parse within the limit does not stay Wanted for ever. A Placeholder Episode that TheTVDB never lists but that holds a file stays, shown as TBA.
- Daily Releases whose air date TheTVDB does not list yet are not covered: they carry no season or number to name a file by, so the Wanted sweep picks them up once TheTVDB lists them.
