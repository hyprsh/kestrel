# A fixed naming scheme with Slot labels

Kestrel names every library folder and file by one fixed scheme, with no naming editor or settings. A Movie lives in `Title (Year) {tmdb-N}/`, and each of its files starts with that exact folder name, followed by ` - ` and the Slot label (`[SD]`, `[HD]` or `[UHD]`), then bracketed quality, edition, language, audio, HDR and codec, and `-GROUP`. A Series lives in `Title (Year) {tvdb-N}/Season 01/` and names its episodes `Title (Year) - S01E01 - [HD]…`. We chose a fixed scheme because several Versions only group as one item when the names obey rules that Plex, Jellyfin (12.0+) and Silo each impose. Jellyfin groups nothing in a folder if a single file breaks the folder-name prefix, and Adoption reads the Slot back from the label. A user-editable template would make both easy to break.

## Considered Options

- **A Radarr/Sonarr-style token editor with this scheme as the default.** Rejected because almost every edit breaks multi-Version grouping in at least one media server, and Adoption could no longer rely on the label.
- **Resolution as the label (`[1080p]`, `[2160p]`).** Rejected because a Kids Version in the HD Slot may hold an SD-resolution file, so two files could share a label and a Slot could not be read from its file.
- **Plex `{edition-…}` tags for Versions or editions.** Rejected because Plex turns each edition into a separate library item.

## Consequences

- The language tag (`[German DL]`, `[German]`, `[English]`, …) describes the file's audio as probed at Import, not its Profile, so switching a Version's Profile never renames it.
- Episode titles are left out, so TBA titles and edits on TheTVDB never cause renames.
- When metadata changes a Title's English title or year, Kestrel renames the folder and every Version's file together, automatically, and logs it in history.
- Changing the scheme later means renaming the whole library, so changes need a migration, not a setting.
