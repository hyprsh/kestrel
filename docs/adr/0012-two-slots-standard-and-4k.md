# A Title holds up to two Versions: Standard and 4K

Supersedes ADR 0001.

A Title has two fixed Slots, Standard (up to 1080p, the default) and 4K (2160p, opt-in), and each holds at most one Version. Files carry the Slot as ` - [Standard]` or ` - [4K]`, and the API and database use `standard` and `4k`. Kestrel keeps a file each audience can play without transcoding and stops there: who may watch 4K, which device gets which file, and what children see are the media server's and Silo's choices, through Silo's access-group quality ceilings, per-device quality caps and request routes. The Standard/4K split is worth keeping because a viewer capped below 4K then plays the Standard file directly instead of a tone-mapped transcode of the 4K one. Standard is named for its role, not a resolution, because its Any Profile also takes SD-only releases.

## Considered Options

- **Three Slots, SD, HD and UHD (ADR 0001).** Rejected: the SD Slot existed for a small mobile file, and Silo now covers that with per-device quality caps for streaming and its own transcoded copies for downloads. The labels also read as resolutions, so a Kids file at 576p was labelled `[HD]`.
- **Admin-defined Slots.** Rejected: the Silo tier mapping, per-Slot defaults, Requests and Adoption all assume a known set, and a household gains nothing from a third Slot.
- **Fixed Slots with an admin-editable display name over a stable file label.** Rejected: the problem was the labels themselves, and Kestrel had no libraries in use to migrate, so the names could simply change.
- **A Kids rule in Kestrel** (an age-rating threshold that picked the Kids Profile and a Kids root folder). Removed: Silo's request routes already match by content rating and can set the root folder and Profiles per request, and audiences are the media server's concern.

## Consequences

- The six Profiles are HD, HD Original, Any and Any Original in Standard, and 4K and 4K Original in 4K. Any takes every resolution up to 1080p, as the Kids Profiles did, and Profiles have no `kids` flag.
- Silo's `1080p` tier maps to Standard and `2160p` to 4K. The Silo plugin's config has `standard_profile`, `4k_profile` and `root_folder`, which a Silo route can override per request, and a Request can name its root folder.
- Media servers pick a Version by its probed resolution, never by the label: Jellyfin defaults to the highest resolution and transcodes, and Silo honours device caps and group ceilings but plays the last-watched Version first.
- The new labels need no migration because no library used the old ones; ADRs 0003, 0004 and 0005 carry a note pointing here.
