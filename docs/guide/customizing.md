# Customizing

Kestrel works with the answers you gave in the setup screen. You don't have to change anything else. This page lists what you can change when you want to, and where.

Everything here is in Settings, unless it says otherwise. "Find a setting" at the top of Settings' list finds one by name. To declare a setting in a file instead, see the [Config File](configuration.md#the-config-file).

## I want to…

| I want to…                                          | Do this                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Keep 1080p and 4K of some Titles                    | Add a 4K Slot, with the 4K Profile as its default ([Versions](#versions-slots)). Turn it on when you add a Title. |
| Keep the dub and the Original Language side by side | Add a Slot whose default is HD Original ([Versions](#versions-slots)).                                            |
| Keep a Remux next to a smaller file                 | Add a Remux Slot, with a Remux Profile as its default ([Versions](#versions-slots)).                              |
| Get one Title in its Original Language              | On its page, open a Version's **...** menu and choose **Switch Profile…**, such as HD Original.                   |
| Get an old Title that never had an HD Release       | **Switch Profile…** to Any.                                                                                       |
| Stop Kestrel replacing files that are good enough   | Set a Cutoff on the Profile ([Quality](#quality-profiles)).                                                       |
| Keep files from getting too large                   | Set the size limits on the Profile ([Quality](#quality-profiles)).                                                |
| Keep kids' Titles in their own folder               | Add a second root folder and choose it when you add a Title ([Folders](#folders)).                                |
| Use a paid indexer only as a fallback               | Give it a higher priority number ([Indexers](#indexers)).                                                         |
| Stop downloads for a while                          | Switch off **Grab automatically** in Settings > Downloads > Automatic Grabs.                                      |
| Let friends ask for Titles                          | Switch on Plex sign-in ([Requests](#requests)).                                                                   |

## Language

Settings > General > Language holds your **Primary language** (English, German or French) and the **Country** whose release dates decide when a Title counts as out. Changing the language re-scores the files you already have.

## Versions (Slots)

A Slot is a place in every Title for one Version, and a Title can have up to four. Settings > Slots & Profiles > Slots is where you add, rename, reorder and delete them, and choose for each:

- Its **default Profile** for a new Movie and for a new Series.
- Whether new Titles get it. Off means you turn it on per Title, as you add it, or later with **Add Version…** in the Title's **...** menu.

A Slot's default must be a Profile you have, so add it from **Suggested** first ([Quality](#quality-profiles)). The label is part of the file name, and renaming a Slot renames its files. [Slots](slots.md) has the rules and examples. A preset sets up a common combination in one step, but only while the library holds no Version: Settings > General > Setup opens the setup screen with the presets again.

## Quality (Profiles)

A Profile decides which Release to grab for a Version. It is a recipe of three choices: a resolution, a Release Family and a language ([Concepts](concepts.md#profile) explains them). Settings > Slots & Profiles > Profiles lists yours:

- **Suggested** lists the recipes you don't have yet. Add one to use it.
- **New Profile…** copies a Profile to start from.
- **Edit** opens a Profile's sheet.

On the sheet you can change:

| Setting                                  | What it does                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Enabled**                              | Whether you can use the Profile. One that a Slot names as its default stays enabled.                                        |
| **Qualities, best first**                | Reorder them, or switch one off so it is never grabbed.                                                                     |
| **Good enough at**                       | The quality at which Upgrades may stop. Empty, quality doesn't stop them.                                                   |
| **Upgrade until Score**                  | The Score at which Upgrades may stop. With both set, a file must reach both. With neither, Upgrades never stop.             |
| **Minimum Score**                        | A Release below it is rejected.                                                                                             |
| **Size per episode**, **Size per Movie** | The smallest and largest a Release may be, in GB. Leave a side empty for no limit.                                          |
| **Audio**                                | What to do with a Release that has only the Original Language: reject it, offer it to you in Needs attention, or accept it. |

The sheet also lists the Custom Formats behind the Score. You can't edit those: they come from [TRaSH Guides](https://trash-guides.info). Kestrel checks for a new set daily. To control that, use **Check TRaSH daily and update automatically** and **Update from TRaSH** in Settings > Slots & Profiles > TRaSH.

To move a Title to another Profile, use **Switch Profile…** in its Version's **...** menu. The Version stays in its Slot.

## Folders

Settings > Library > Root folders holds a list for Movies and one for Series. **Add Folder** adds another, such as `/data/media/movies-kids`, and **Make Default** chooses the one new Titles start with. You pick a folder when you add a Title, and **Move…** in a Title's **...** menu moves it later. Keep every root folder on the same mount as your downloads, or Imports can't hardlink.

File names follow one fixed scheme, which you can't change. That keeps a Title's Versions grouped as one item in Plex and Jellyfin.

## Indexers

Settings > Downloads > Indexers holds your indexers, and **Add Indexer…** adds another. On each one you can set:

- **Priority:** indexers with the same priority are asked together, lowest number first. An automatic search asks the next priority only for what the earlier ones left, so a higher number makes a fallback. With every indexer at one priority, every search asks them all. Dragging the list also sets the priorities, one per indexer.
- **Seconds between searches**, **API requests per day** and **Grabs per day:** keep Kestrel inside your indexer's limits ([An indexer's daily limit](troubleshooting.md#an-indexers-daily-limit)).

## Media servers

Settings > Media servers connects Jellyfin, Plex and Silo. Kestrel then asks them to refresh after an Import. Kestrel works without any of them.

## Requests

Other people can ask for Titles without you adding them. Settings > Security & Access > Plex sign-in lets people who share your Plex server sign in to Kestrel. It needs a Plex media server connected first.

| Setting                            | What it does                                                                |
| ---------------------------------- | --------------------------------------------------------------------------- |
| **Users**                          | Only these Plex users may ask. Leave it empty for everyone with access.     |
| **Root folders per user**          | Where one person's new Titles go, such as the kids' folder.                 |
| **Make Requests from Watchlists**  | Adding to a Plex Watchlist makes a Request.                                 |
| **Watch-ahead for Series**         | A Series starts with season 1, and the next comes once someone is watching. |
| **Requested labels in Plex**       | Marks requested Titles with labels and a collection.                        |
| **Requested poster badge in Plex** | Stamps a "Requested" badge on their posters, for **Poster badge days**.     |

A Request gets every Slot that is on for new Titles, each under its default Profile. [Requesters](configuration.md#requesters-plex-sign-in) has the details, and [Silo requests](configuration.md#silo-requests-and-slots) covers requests from Silo.

## Display

Settings > General > Display holds how views start for everyone in the household:

- **Season order**, and **Open the newest season** on a Series page.
- **Manual search sort**.
- **Upcoming starts on**, **Upcoming shows**, **Wanted only** and **Hide imported**.

A sort or filter you pick on a screen still wins for you. The theme switcher is near the bottom of the rail.

## What you can't change

Kestrel makes fewer things configurable on purpose. These are fixed:

- The naming scheme.
- Custom Formats and their Scores.
- The download client (SABnzbd) and the kind of indexer (Newznab). There are no torrents.
- The languages (English, German and French as a Primary Language).
- A Profile outside a recipe TRaSH backs.

[What has no equivalent](moving-from-radarr-and-sonarr.md#what-has-no-equivalent) has more, if you are coming from Radarr or Sonarr.
