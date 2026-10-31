# Moving from Radarr and Sonarr

Kestrel replaces Radarr and Sonarr with one app. You don't have to start over: Kestrel can take in the library you already have, and you can run both until you trust it.

Read [Getting started](getting-started.md) first and set Kestrel up with a download client and an indexer. This page covers what is different.

## How Kestrel compares

| In Radarr and Sonarr                                                    | In Kestrel                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two apps: Radarr for Movies, Sonarr for Series                          | One app. A Movie and a Series are two kinds of **Title**.                                                                                                                                               |
| A second Radarr or Sonarr for 4K                                        | Two [Slots](concepts.md#slot) in one app: **Standard** (up to 1080p) and **4K**. A Title can hold a file in each, side by side.                                                                         |
| Quality profiles                                                        | [Profiles](concepts.md#profile). Six fixed ones: HD, HD Original, Any, Any Original, 4K and 4K Original. You switch them on and off and choose defaults.                                                |
| Custom Formats and their scores, imported with a tool such as Recyclarr | Built in. Kestrel ships [TRaSH Guides](https://trash-guides.info)' Custom Formats and Scores for each Profile, and updates them daily. You don't import or edit them.                                   |
| A language set in a profile or a Custom Format                          | A [Primary Language](concepts.md#profile) for the whole library (English, German or French), and a Profile choice: Primary Language or the Title's Original Language.                                   |
| Quality cutoff and "Cutoff Unmet"                                       | No cutoff. A monitored Version [upgrades](concepts.md#upgrade) as long as a better Release appears. Everything without a good file is [Wanted](concepts.md#wanted).                                     |
| Root folders                                                            | Root folders, one list for Movies and one for Series, with a default each. Choose one when you add a Title.                                                                                             |
| Monitored                                                               | Monitored, per Title and, for a Series, per season and episode. The add panel offers presets.                                                                                                           |
| Calendar                                                                | **Upcoming**: the last two weeks to the next two months, with where each item stands.                                                                                                                   |
| Queue, History                                                          | **Activity** for Grabs and background jobs, and the **Log** for everything Kestrel did.                                                                                                                 |
| Download clients                                                        | SABnzbd only, for now.                                                                                                                                                                                  |
| Indexers synced from Prowlarr                                           | Newznab indexers added directly, each with an optional daily limit on API requests and on Grabs.                                                                                                        |
| Import lists, Overseerr or Jellyseerr                                   | **Requests**: people who share your Plex server sign in to Kestrel with Plex, and Kestrel can read Plex Watchlists. Silo users can ask too. See [Requesters](configuration.md#requesters-plex-sign-in). |
| Connect: refresh Jellyfin or Plex                                       | Kestrel refreshes Jellyfin and Plex after an Import (Settings > Media servers).                                                                                                                         |
| Naming format                                                           | One fixed naming scheme, so that Plex and Jellyfin group a Title's Versions as one item ([ADR 0003](../adr/0003-fixed-naming-scheme-with-slot-labels.md)).                                              |

## What has no equivalent

Kestrel makes fewer things configurable. If you rely on one of these, check before you switch:

- **Torrents and other download clients.** Kestrel is usenet only, with SABnzbd.
- **Editing Custom Formats and Scores.** There is no editor. A score that bothers you is TRaSH's to change, or a reason to pick another Profile.
- **Other quality ladders.** The six Profiles are all there is. A 720p-only or "any resolution" setup isn't one of them, apart from Any, which takes every resolution up to 1080p.
- **A naming editor.** The scheme is fixed.
- **Tags, delay profiles, release restrictions and notifications.** None of these exist. The Blocklist keeps out Releases that failed, and Pause Grabs stops all downloads for a while (Settings > Grabs).
- **A Prowlarr connection.** Add each indexer by hand.
- **A third Slot.** A Title has Standard and 4K, and nothing more ([ADR 0012](../adr/0012-two-slots-standard-and-4k.md)).

## Point Kestrel at your library

**Adoption** scans files that are already on disk, matches them to Titles and Versions, and lets Kestrel manage them without downloading again.

Adoption renames files into Kestrel's scheme and moves them into the Title's folder, such as `Paddington (2014) {tmdb-116149}/`. Radarr and Sonarr will then see their files as missing. So back up your library and both apps' databases first, and don't let Radarr or Sonarr manage the same folders afterwards ([Running both](#running-both-side-by-side) shows how).

1. **Set the root folders.** In the setup screen or Settings > Root folders, enter the folders your library already lives in, such as `/data/media/movies` and `/data/media/tv`. Keep them on the same mount as your downloads.
2. **Scan.** Choose **Adopt** in the Library, or Settings > Existing files (also the last step of the setup screen), then **Scan for existing files**. Kestrel reads each folder and file, and plans:
   - **Matched:** Kestrel found the Title and its Version. These are ticked, and adopted when you commit.
   - **Needs choice:** Kestrel found candidates and ranks the best one as a suggested match. A match is _Confident_ when the year, the title and the runtime all fit and no other candidate comes close. Choose the right one by hand, or **Accept suggested matches** to settle only the Confident ones.
   - **Skipped:** Kestrel can't manage it, and says why: no readable video file, no enabled Profile for its Slot, or a Series that is not on TheTVDB.
3. **Review the plan.** Nothing changes until you commit. Untick what you don't want, and choose how adopted Titles are monitored.
4. **Adopt.** Choose **Adopt N Titles**. A Title either adopts completely or not at all: if one rename fails, the others for that Title are undone. The rows stay, with each outcome, until the next scan. **Try again** puts failed ones back under review.
5. **Clean up.** Files under a root folder that no Version holds are called _unmanaged_. **Clean up** in the Library lists them, and can delete the ones you don't want.

Kestrel matches best when a folder or file name carries an ID, such as `{tmdb-116149}`, `[tmdbid-116149]` or `[imdbid-tt1109624]`, which Radarr and Sonarr can add. It takes an ID as certain.

A file's Slot comes from its resolution, unless its name carries Kestrel's own `- [Standard]` or `- [4K]` label. Its Profile is the default of that Slot, or Any when the default wouldn't accept the file, such as a 576p one. Check a few Titles afterwards. You can switch a Version's Profile at any time.

## How your quality profiles map

You can't import Radarr's or Sonarr's quality profiles or Custom Formats. Match your intent to one of Kestrel's Profiles:

| If your profile was...                                          | Use                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A 1080p profile, TRaSH's "HD Bluray + WEB" or similar           | **HD** as the Standard default                                                                               |
| A "take anything up to 1080p" profile for old or obscure Titles | **Any**                                                                                                      |
| A 2160p profile, TRaSH's "UHD Bluray + WEB" or similar          | **4K**, in the 4K Slot. Tick 4K when you add a Title                                                         |
| A profile that wants the original audio, such as for anime      | **HD Original** or **4K Original**                                                                           |
| A German or French dub preference through Custom Formats        | Set your Primary Language to German or French. **HD** then requires it, and a "DL" or "MULTi" Release counts |
| Your own Custom Formats or scores                               | No equivalent. Kestrel's Scores are TRaSH's                                                                  |

If you used TRaSH Guides' profiles and Custom Formats already, Kestrel's scoring will feel familiar: its Profiles are backed by the same ones.

## Running both side by side

Until you trust Kestrel, you can run it next to Radarr and Sonarr. Keep it from fighting them:

- **Use different folders.** Give Kestrel its own root folders, such as `/data/media/movies-kestrel`, and add Titles there. Don't adopt the folders Radarr and Sonarr still manage. Adoption renames files, which Radarr and Sonarr would see as missing.
- **Use separate download categories.** Create `movies-kestrel` and `tv-kestrel` in SABnzbd, and enter them in Kestrel's download client, so each app only sees its own downloads.
- **Don't let two apps grab the same Title.** Add a Title to Kestrel only after you unmonitor it in Radarr or Sonarr.
- **Watch your indexer's limits.** Both apps spend the same daily API requests and grabs. Set **API requests per day** and **Grabs per day** on Kestrel's indexer to leave room.
- **Mind your media server.** Two copies of one Title in two libraries show up twice. Keep Kestrel's folders in their own library until you switch.

## Switching over

When you are ready:

1. Back up everything.
2. In Radarr and Sonarr, unmonitor all Titles, or stop the containers. Keep them for a while as a record. Their databases are your history.
3. Point Kestrel's root folders at your real library and adopt it, as above.
4. In Plex or Jellyfin, remove the Radarr and Sonarr connections, and connect Kestrel in Settings > Media servers.
5. Move your requests over: switch on [Requesters](configuration.md#requesters-plex-sign-in) so the people you share with can ask Kestrel instead of Overseerr or Jellyseerr.
6. Watch Needs attention and the Log for a week. [Troubleshooting](troubleshooting.md) covers the usual problems.
