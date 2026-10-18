# Kestrel

Kestrel finds, downloads and files movies and series for one household's media library, replacing Radarr and Sonarr with a single app.

## Language

### Library

**Title**:
A movie or a series that Kestrel tracks. The shared concept behind both kinds wherever they behave alike.
_Avoid_: Media, item, show (for both kinds)

**Movie**:
A Title that is one film.
_Avoid_: Film

**Series**:
A Title made of seasons and episodes.
_Avoid_: Show, TV show

**Placeholder Episode**:
An episode Kestrel added itself because a Release named it before TheTVDB listed it. It has a season and number but no name or air date until a metadata refresh adopts it.
_Avoid_: TBA episode, ghost episode

**Profile**:
A named, switchable quality-and-language target, such as UHD or HD, backed by a TRaSH profile. Each Profile belongs to one Slot, covers a fixed resolution range, and either requires the Primary Language or requires the Title's Original Language. Profiles can be enabled or disabled and chosen as the default for a Slot in new Movies or new Series. A Version's Profile can be switched at any time to another Profile of the same Slot.
_Avoid_: Quality profile, preset

**Slot**:
One of SD, HD and UHD: the place in a Title that one Version fills. A Title has at most one Version per Slot and at least one Version overall. HD is the standard Slot and the default for new Titles; SD and UHD are opt-in.
_Avoid_: Tier (TRaSH uses it for release groups)

**Primary Language**:
The household's own language, chosen once for the whole library: English, German or French. Profiles require it unless they require the Original Language instead.
_Avoid_: Household language, dub language, German (when the Primary Language is meant)

**Original Language**:
The language a Title was made in, as its metadata states. A Profile can require it instead of the Primary Language.
_Avoid_: O-Ton, VO, English (when the Original Language is meant)

**Version**:
A Title's wanted copy in one Slot, under that Slot's chosen Profile, kept as its own file. Each Version is filled and upgraded on its own: a Release only ever replaces the file of the Version whose Profile it matches, never another Version's. All Versions of a Title live side by side in its folder. A Series Version holds one file per episode and is filled episode by episode.
_Avoid_: Edition, copy, quality (as a noun for the Slot)

**Dual-Language Release**:
A release carrying Primary Language audio plus the Title's Original Language audio in one file, labelled "DL" in German scene names and "MULTi" in French ones. For an English-original Title in a German household that means German and English. Language is a preference within a Version, not a separate Version.
_Avoid_: Multi-audio, DL or MULTi (unexpanded)

**Upgrade**:
Replacing a Version's file with a better-scoring Release. Versions never stop upgrading; there is no cutoff.

**Wanted**:
A monitored, released Version, or episode of a Series Version, that has no file or whose file no longer fits its Profile. An episode counts as released once it has aired, once it is a Placeholder Episode, or, without an air date, once a later episode of its Series is out. Unmonitored and unreleased ones are not Wanted, and a filled Version waiting for an Upgrade is not Wanted either.
_Avoid_: Missing (for the whole set), cutoff unmet

**Long Missing**:
Wanted for more than 90 days, counted from the later of its release and the moment it became Wanted. A Series Version is Long Missing once any of its episodes is.
_Avoid_: Stale, abandoned

**Adoption**:
Scanning files already on disk and matching them to Titles and Versions, so Kestrel manages them without downloading again.
_Avoid_: Import (reserved for completed downloads)

**Unmanaged file**:
A file under a root folder that no Version holds. Adoption can take it in, and Clean up can delete it.
_Avoid_: Untracked, orphaned, stray (file)

### Downloading

**Release**:
One downloadable post found on an indexer, identified by its release name.
_Avoid_: NZB, result, torrent

**Custom Format**:
A named trait a Release can have, such as a release group tier, a Dual-Language Release or an unwanted encode, defined by TRaSH and worth a number of points under each Profile.
_Avoid_: CF (unexpanded), tag, rule

**Score**:
The sum of the points of every Custom Format a Release matches under one Profile. The higher Score wins a Grab or an Upgrade.
_Avoid_: Rating, rank

**Grab**:
Choosing a Release for a Version and handing it to the download client. Every download Kestrel tracks traces back to one Grab.
_Avoid_: Snatch, download (as a noun)

**Blocklist**:
Releases that failed and are never grabbed again.
_Avoid_: Blacklist

**Import**:
Moving a completed download into the library under its Title's folder and naming scheme.

### Requests

**Request**:
An ask from outside Kestrel, such as from a Silo user, for a Title in one or more Slots, each optionally under a named Profile. It adds the Title or its missing Versions, never changes existing ones, and carries who asked. Adding a Title or Version in Kestrel's own UI is not a Request.
_Avoid_: Add (for Requests), order

**Upcoming**:
The list of episodes and movie releases expected soon, standing in for a calendar.
_Avoid_: Calendar
