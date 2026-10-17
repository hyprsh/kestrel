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

**Profile**:
A named, switchable quality-and-language target, such as UHD or HD, backed by a TRaSH profile. Profiles can be enabled or disabled and marked as default for new Movies or new Series.
_Avoid_: Quality profile, preset

**Version**:
A Title's wanted copy under one Profile, kept as its own file. Each Version is filled and upgraded on its own: a Release only ever replaces the file of the Version whose Profile it matches, never another Version's. All Versions of a Title live side by side in its folder.
_Avoid_: Edition, copy, quality (as a noun for the slot)

**Dual-Language Release**:
A release carrying German audio plus the Title's original-language audio in one file, labelled "German DL" in the scene. For an English-original Title that means German and English. Language is a preference within a Version, not a separate Version.
_Avoid_: Multi-audio, DL (unexpanded)

**Upgrade**:
Replacing a Version's file with a better-scoring Release. Versions never stop upgrading; there is no cutoff.

**Adoption**:
Scanning files already on disk and matching them to Titles and Versions, so Kestrel manages them without downloading again.
_Avoid_: Import (reserved for completed downloads)

### Downloading

**Release**:
One downloadable post found on an indexer, identified by its release name.
_Avoid_: NZB, result, torrent

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
An ask, from outside Kestrel (such as a Silo user), for a Title under a Profile, which adds the Title or a new Version to it. Carries who asked.

**Upcoming**:
The list of episodes and movie releases expected soon, standing in for a calendar.
_Avoid_: Calendar
