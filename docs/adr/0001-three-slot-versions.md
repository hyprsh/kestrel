# A Title holds up to three Versions, one per Slot

Status: superseded by ADR-0012 (two Slots, Standard and 4K).

A Title has three Slots (SD, HD and UHD). Each Slot holds at most one Version, kept as its own file in the Title's folder, and a Title always has at least one Version. HD is the standard Slot and the default; SD and UHD are opt-in. Versions never overwrite each other: a UHD Release fills the UHD Version and never replaces the HD file, and Upgrades happen only within a Version. We chose this over Radarr/Sonarr's one-file-per-Title model because the household wants an HD file that plays everywhere next to a UHD file for the big screen, and a small SD file for Silo's mobile app. The same split matches Silo's "separate HD and 4K instance" request pattern, which Kestrel replaces with a single app.

## Considered Options

- **One Version per Title, upgraded through to UHD** (the Radarr/Sonarr default). Rejected because a UHD file replaces the HD file that clients without UHD support depend on.
- **One Version per selected Profile, with no Slots.** Rejected because overlapping Profiles (HD, Kids, HD Original all cover 1080p) would collect near-identical files. Slots allow one Profile per Slot, so language and Kids are choices within a Version, not extra Versions.
- **Two Slots (Standard and 4K).** Rejected once SD was wanted as its own small file beside HD.

## Consequences

- Kids sits in the HD Slot but accepts SD, so a Title with both Kids and SD Versions can briefly hold two SD files. We accept that rather than add a special rule.
- Every Grab, Import, Upgrade and Blocklist entry targets one Version, never a Title as a whole.
- File naming must tell the Versions apart in one folder (` - [SD]`, ` - [HD]`, ` - [UHD]`), and Plex, Jellyfin (12.0+) and Silo must group them as one item.
