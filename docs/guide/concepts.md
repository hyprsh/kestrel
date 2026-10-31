# Concepts in plain words

Kestrel uses a handful of words with a fixed meaning, and the app, the guides and the API all use them the same way. This page explains each with an example. [`GLOSSARY.md`](../../GLOSSARY.md) is the canonical vocabulary, with the exact definitions and the words Kestrel avoids.

Here is the whole flow in one picture. You add a **Title**. Kestrel makes a **Version** of it in each **Slot** you chose, under a **Profile**. A Version with no file is **Wanted**. Kestrel searches your indexers, scores the **Releases** it finds, picks one in a **Grab** and hands it to your download client. When the download finishes, Kestrel runs an **Import**: the file moves into your library.

## Title

A movie or a series that Kestrel tracks. It comes in two kinds: a **Movie** is one film, and a **Series** is seasons and episodes.

Example: _Paddington_ (2014) is a Movie, and _Breaking Bad_ is a Series. Kestrel looks up Movies at TMDB and Series at TheTVDB, so a Title's posters, seasons and air dates come from there ([ADR 0002](../adr/0002-tmdb-for-movies-tvdb-for-series.md)).

## Slot

A place in a Title for one copy of it. There are two fixed Slots: **Standard**, up to 1080p, and **4K**, which is opt-in. A Title has at most one copy per Slot, and at least one copy overall.

Example: a gaming group keeps _Cyberpunk: Edgerunners_ in Standard only, because the TV in the living room is 1080p. The Household's film nights want _Dune_ in both, so the 4K projector gets the 4K file and the tablet in the kitchen gets the Standard one. Which copy plays is the media server's choice. Kestrel never decides who may watch 4K.

## Version

A Title's wanted copy in one Slot, kept as its own file. Each Version is filled and upgraded on its own: a new Release only ever replaces the file of the Version it matches.

Example: _Dune_ has two Versions, Standard and 4K. Kestrel finds a better 1080p Release and replaces only the Standard file. The 4K file stays. Both live side by side in the Title's folder. For a Series, a Version holds one file per episode and fills episode by episode.

## Profile

A named quality-and-language target that a Version follows, such as HD, Any or 4K. Each Profile belongs to one Slot and covers a fixed range of resolutions. Kestrel has six, backed by [TRaSH Guides](https://trash-guides.info) profiles:

| Profile      | Slot     | Takes                        | Language                            |
| ------------ | -------- | ---------------------------- | ----------------------------------- |
| HD           | Standard | HD resolutions, up to 1080p  | Needs your Primary Language         |
| HD Original  | Standard | HD resolutions, up to 1080p  | Needs the Title's Original Language |
| Any          | Standard | Every resolution up to 1080p | Needs your Primary Language         |
| Any Original | Standard | Every resolution up to 1080p | Needs the Title's Original Language |
| 4K           | 4K       | 4K                           | Needs your Primary Language         |
| 4K Original  | 4K       | 4K                           | Needs the Title's Original Language |

Your **Primary Language** is the one language your library is for: English, German or French, set once in Settings. The **Original Language** is the language a Title was made in.

Example: a German household sets German. For a Japanese anime, the HD Profile wants German audio, and HD Original wants Japanese. If only a Japanese Release exists, the HD Profile can reject it, offer it to you in Needs attention, or accept it, as you choose in Settings > Profiles. A release with both languages in one file (marked "DL" in German release names and "MULTi" in French ones) counts as having your Primary Language.

You can switch a Version to another Profile of the same Slot at any time.

## Custom Format and Score

A **Custom Format** is a named trait a Release can have, such as being from a trusted release group, carrying both languages, or being an unwanted encode. TRaSH Guides defines them. Each is worth a number of points under a Profile.

A Release's **Score** is the sum of the points of every Custom Format it matches under that Profile. The higher Score wins a Grab or an Upgrade.

Example: for the HD Profile, a 1080p Release from a top release group matches a Custom Format worth many points. An otherwise identical one from an unknown group matches none, scores lower, and loses. You don't edit Scores in Kestrel. They come from TRaSH, and Kestrel refreshes them daily (Settings > TRaSH).

## Wanted

A Version, or an episode of a Series Version, that Kestrel should have and doesn't, or whose file no longer fits its Profile. It has to be monitored and released.

Example: _Paddington in Peru_ is in your Library, but its Standard Version has no file yet. It is Wanted from its release date on, and Kestrel searches for it every five minutes until it finds a Release. An episode counts as released once it has aired, so next Tuesday's episode of a Series isn't Wanted until Tuesday. An unmonitored Title or episode is never Wanted. A file waiting for an Upgrade isn't Wanted either: it is already filled.

The Library filter `is:wanted` lists everything Wanted.

## Long Missing

A Version that has been Wanted for more than 90 days. A Series Version is Long Missing once any of its episodes is. Kestrel counts from the later of the release and the moment it became Wanted, and shows how many on the Overview.

Example: a rare 4K Release of an old film that no indexer has. After three months Needs attention on the Overview says "1 Version long missing", so you can decide to drop the 4K Version or look elsewhere.

## Grab

Choosing a Release for a Version and handing it to the download client. Every download Kestrel tracks traces back to one Grab. Activity shows each Grab from searching to Import, grouped by stage.

Example: Kestrel searches for _Paddington 2_, scores 12 Releases, and picks the best one that fits. It sends that NZB to SABnzbd. That is a Grab. If the download fails, the Release goes on the **Blocklist**, so Kestrel never grabs it again, and the next search picks another.

## Import

Moving a completed download into your library, under its Title's folder and naming scheme. Kestrel hardlinks the file when downloads and library share a mount, so it takes no extra space ([The `/data` layout](getting-started.md#the-data-layout)).

Example: SABnzbd finishes `Paddington.2.2017.1080p.BluRay-GRP`. Kestrel imports it to `/data/media/movies/Paddington 2 (2017) {tmdb-346648}/` and names it `Paddington 2 (2017) - [Standard] …`. Then it tells Plex or Jellyfin to refresh.

Adopting files that are already in your library is a different thing, called **Adoption**. See [Moving from Radarr and Sonarr](moving-from-radarr-and-sonarr.md).

## Upgrade

Replacing a Version's file with a better-scoring Release. Monitored Versions never stop upgrading, and there is no quality cutoff. An unmonitored Title is not upgraded.

Example: you import a 1080p WEB-DL of a new film. Weeks later a BluRay Release with a higher Score appears, and Kestrel grabs it and replaces the file.

## Requests

An ask from someone other than the admin, such as a person who shares your Plex server or a Silo user, for a Title in one or more Slots. A Request adds the Title or its missing Versions, and never changes existing ones. It carries who asked. You adding a Title yourself is not a Request. [Configuration](configuration.md#requesters-plex-sign-in) explains how people sign in.
