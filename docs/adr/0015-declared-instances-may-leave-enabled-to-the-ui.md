# A declared plugin instance's enabled belongs to the UI unless the Config File sets it

ADR 0014 made a declared plugin instance read-only as a whole, `enabled` included. To switch off an indexer or a download client for a while, say because its service is down or out of quota, that meant editing the file and restarting Kestrel. Now the Config File owns a declared instance's `enabled` only when it sets it. When the file leaves `enabled` out, the UI and the API manage it, the same way they manage a section the file leaves out. This amends the consequence in ADR 0014 that "a declared plugin instance is read-only as a whole, `enabled` included". Profiles' `enabled` and `reverse_proxy.enabled` stay locked while declared.

## Considered Options

- **Keep `enabled` locked with the rest of the instance.** Rejected because a temporary outage then costs a file change and a restart, and the file usually has no opinion on whether an instance is on.
- **Make `enabled` always the UI's.** Rejected because a deployment that sets `enabled` in the file means it, and until now the file decided.
- **Store which fields the file declared.** Rejected because the file is read at every start and the API holds it: a declared `enabled` is a fact about the current file, so it needs no column and no migration.

## Consequences

- A plugin instance reports `enabled_declared` beside `from_config_file`. `PATCH /plugin-instances/{id}` on a declared instance accepts a patch that changes only `enabled` while `enabled_declared` is `false`; every other field, and `enabled` once the file sets it, still answers 409 naming the file.
- Startup applies `enabled` only when the file sets it. A stored declared instance keeps its stored `enabled` across restarts, and a taken-over UI instance keeps the one it had. A newly declared instance still starts enabled.
- The startup check of a contract's cap on enabled instances (one download client) counts the stored `enabled` for a declared instance whose `enabled` the file leaves out. A toggle in the UI goes through the usual cap check.
- Taking `enabled` out of the file leaves the last value the file set, as for any declared value that leaves the file.
