# Concepts in plain words

Kestrel uses a handful of words with a fixed meaning, and the app, the guides and the API all use them the same way. This page explains each with an example. [`GLOSSARY.md`](../../GLOSSARY.md) is the canonical vocabulary, with the exact definitions and the words Kestrel avoids.

Here is the whole flow in one picture. You add a **Title**. Kestrel makes a **Version** of it in each **Slot** you chose, under a **Profile**. A Version with no file is **Wanted**. Kestrel searches your indexers, scores the **Releases** it finds, picks one in a **Grab** and hands it to your download client. When the download finishes, Kestrel runs an **Import**: the file moves into your library.

## Title

A movie or a series that Kestrel tracks. It comes in two kinds: a **Movie** is one film, and a **Series** is seasons and episodes.

Example: _Paddington_ (2014) is a Movie, and _Breaking Bad_ is a Series. Kestrel looks up Movies at TMDB and Series at TheTVDB, so a Title's posters, seasons and air dates come from there.

## Slot

A named place in a Title for one copy of it, and the name of that copy's file. You define them: a fresh install starts with **Standard**, a library that already existed keeps **Standard** and **4K**, and you can add, rename, reorder and remove Slots, up to four. A Title has at most one copy per Slot, and at least one copy overall. A Slot says which copy a Version is; a Profile says which Release to grab for it. [Slots](slots.md) has the rest, with a Remux and a dub as examples.

Example: a gaming group keeps _Cyberpunk: Edgerunners_ in Standard only, because the TV in the living room is 1080p. The Household's film nights want _Dune_ in both, so the 4K projector gets the 4K file and the tablet in the kitchen gets the Standard one. Which copy plays is the media server's choice. Kestrel never decides who may watch 4K.

## Version

A Title's wanted copy in one Slot, kept as its own file. Each Version is filled and upgraded on its own: a new Release only ever replaces the file of the Version it matches.

Example: _Dune_ has two Versions, Standard and 4K. Kestrel finds a better 1080p Release and replaces only the Standard file. The 4K file stays. Both live side by side in the Title's folder. For a Series, a Version holds one file per episode and fills episode by episode.

## Profile

A named quality-and-language target that a Version follows, such as HD, Any or 4K Remux. A Profile is a recipe of three choices, and belongs to no Slot: any Profile can fill any Slot, and a Slot names its default Profile per kind. Kestrel backs each recipe with the matching [TRaSH Guides](https://trash-guides.info) profile.

- **Resolution:** HD (up to 1080p), 4K, or Any (every resolution up to 1080p, for Titles that never had an HD Release).
- **Release Family:** which kind of Releases it goes after, as TRaSH groups them. **Bluray + WEB** takes encodes from either source, **Remux + WEB** takes untouched Blu-ray remuxes and WEB downloads, **WEB** takes WEB downloads only, and **SQP** is TRaSH's streaming-quality set. Any is always Bluray + WEB.
- **Language:** your Primary Language, the Title's Original Language, or one named language (English, German or French).

A fresh install starts with no Profiles: you add the ones you want from a Slot preset in the setup, or from **Suggested** in Settings > Slots & Profiles ([Slots](slots.md#start-from-a-preset)). An install that already had Profiles keeps its six, listed below. A Profile that names a language, such as "HD German", always wants that language, whatever your Primary Language is.

| Profile      | Resolution | Release Family | Language                            |
| ------------ | ---------- | -------------- | ----------------------------------- |
| HD           | HD         | Bluray + WEB   | Needs your Primary Language         |
| HD Original  | HD         | Bluray + WEB   | Needs the Title's Original Language |
| Any          | Any        | Bluray + WEB   | Needs your Primary Language         |
| Any Original | Any        | Bluray + WEB   | Needs the Title's Original Language |
| 4K           | 4K         | Bluray + WEB   | Needs your Primary Language         |
| 4K Original  | 4K         | Bluray + WEB   | Needs the Title's Original Language |

Your **Primary Language** is the one language your library is for: English, German or French, set once in Settings. The **Original Language** is the language a Title was made in.

Example: a German household sets German. For a Japanese anime, the HD Profile wants German audio, and HD Original wants Japanese. If only a Japanese Release exists, the HD Profile can reject it, offer it to you in Needs attention, or accept it, as you choose in Settings > Slots & Profiles. A release with both languages in one file (marked "DL" in German release names and "MULTi" in French ones) counts as having your Primary Language.

Not every recipe exists, because Kestrel never falls back to another language or another Release Family. A recipe is only offered where TRaSH has a profile for it. English has all four Release Families. German has Bluray + WEB and Remux + WEB, and no WEB or SQP: a German household has no WEB recipe for its Primary Language, but it can add "WEB English", which asks for English audio and is backed by TRaSH's English WEB profile. French has Bluray + WEB, and Remux + WEB for Movies only. SQP has Movies only. A Profile that covers only Movies can't be a Slot's default for Series, and Kestrel refuses a Version of a Series under it.

You can switch a Version to another Profile at any time. A Title can't use the same Profile in two Versions.

In Settings > Slots & Profiles you can also change what each Profile accepts, on top of what TRaSH gives it: reorder or switch off qualities, choose where Upgrades stop (see [Upgrade](#upgrade)), set a minimum Score, set a smallest and largest size per Movie and per episode, and choose what happens to a Release that has only the Original Language. **New Profile…** copies a Profile to start from.

## Custom Format and Score

A **Custom Format** is a named trait a Release can have, such as being from a trusted release group, carrying both languages, or being an unwanted encode. TRaSH Guides defines them. Each is worth a number of points under a Profile.

A Release's **Score** is the sum of the points of every Custom Format it matches under that Profile. The higher Score wins a Grab or an Upgrade.

Example: for the HD Profile, a 1080p Release from a top release group matches a Custom Format worth many points. An otherwise identical one from an unknown group matches none, scores lower, and loses. You don't edit Custom Formats or their Scores in Kestrel. They come from TRaSH, and Kestrel refreshes them daily (Settings > Slots & Profiles > TRaSH). What you can set per Profile is a minimum Score.

## Wanted

A Version, or an episode of a Series Version, that Kestrel should have and doesn't, or whose file no longer fits its Profile. It has to be monitored and released.

Example: _Paddington in Peru_ is in your Library, but its Standard Version has no file yet. It is Wanted from its release date on, and Kestrel keeps searching for it until it finds a Release, closely at first and then less and less often (see below). An episode counts as released once it has aired, so next Tuesday's episode of a Series isn't Wanted until Tuesday. An unmonitored Title or episode is never Wanted. A file waiting for an Upgrade isn't Wanted either: it is already filled.

The Library filter `is:wanted` lists everything Wanted.

### How often Kestrel searches

Kestrel searches a Wanted Version again and again on a schedule that follows how recent the content is. Releases show up in the first hours and days after a Movie comes out or an episode airs, and rarely long after. The age counts from the Movie's release, or for a Series from the latest aired episode of the season (each season is scheduled on its own).

| Recency                                                         | Searches                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Recent:** out within 30 days of when it became Wanted         | When it becomes Wanted, then 1, 3 and 7 days after, then weekly, then every 30 days once it is Long Missing (90 days after the release). |
| **Old:** out more than 30 days before it was added or monitored | When you add it, once more a day later, then every 30 days.                                                                              |
| **Upcoming:** not out yet                                       | Not searched. Once it is out it is Recent.                                                                                               |

An old Movie that you add today, or a Series that ended years ago, is therefore searched twice in its first day and then once a month, not daily and weekly. A new episode that airs in an old Series restarts the early schedule for its season, a day after it airs. A Movie with no release date anywhere is searched weekly until a Release for it is seen.

Other searches fit in like this:

- Any search that completes counts as the Version's search, whatever started it: **Search now**, a bulk Search, a retry or the schedule. The next scheduled search is counted from it.
- A search that cannot finish (an indexer fails, a Grab cannot be sent) is tried again after 15 minutes, then 30 minutes, 1 hour and so on, but never later than the next scheduled search. A search that completes ends the backoff.
- When an Import is rejected, or you cancel a Grab and blocklist it, Kestrel looks for the next best Release at once, and only for the season or episodes that Grab was for. If the same Version is rejected or blocklisted again, the next such retry waits 15 minutes, then 30 minutes, 1 hour and so on up to 24 hours. A successful Import ends the waiting. The scheduled search makes the retry that had to wait.
- **Search now** always runs at once.

The Title page shows **Last search** and **Next search** for a Wanted Version.

## Long Missing

A Version that has been Wanted for more than 90 days. A Series Version is Long Missing once any of its episodes is. Kestrel counts from the release, so an old Movie that you add today is Long Missing at once. It shows how many on the Overview. A Long Missing Version is searched every 30 days.

Example: a rare 4K Release of an old film that no indexer has. After three months Needs attention on the Overview says "1 Version long missing", so you can decide to drop the 4K Version or look elsewhere.

## Grab

Choosing a Release for a Version and handing it to the download client. Every download Kestrel tracks traces back to one Grab. Activity shows each Grab from searching to Import, grouped by stage.

Example: Kestrel searches for _Paddington 2_, scores 12 Releases, and picks the best one that fits. It sends that NZB to SABnzbd. That is a Grab. If two Versions of the Title pick the same Release, it is downloaded once and imported into both. If the download fails, the Release goes on the **Blocklist**, so Kestrel never grabs it again, and the next search picks another.

## Import

Moving a completed download into your library, under its Title's folder and naming scheme. Kestrel hardlinks the file when downloads and library share a mount, so it takes no extra space ([The `/data` layout](getting-started.md#the-data-layout)).

Example: SABnzbd finishes `Paddington.2.2017.1080p.BluRay-GRP`. Kestrel imports it to `/data/media/movies/Paddington 2 (2017) {tmdb-346648}/` and names it `Paddington 2 (2017) {tmdb-346648} - [Standard] …`. Then it tells Plex or Jellyfin to refresh.

Adopting files that are already in your library is a different thing, called **Adoption**. See [Moving from Radarr and Sonarr](moving-from-radarr-and-sonarr.md).

## Upgrade

Replacing a Version's file with a better-scoring Release. A monitored Version keeps upgrading until its file reaches its Profile's **Cutoff**, and a Profile with no Cutoff never stops. You set a Cutoff in Settings > Slots & Profiles, on a Profile's Edit sheet: **Good enough at** names a quality, and **Upgrade until Score** a Score. A file has reached the Cutoff when its quality is that one or a better one and its Score is at least the Upgrade-until Score. Whichever of the two you leave empty isn't checked. A file that has reached it is left alone. A file below the Cutoff isn't Wanted, it only waits for an Upgrade. An unmonitored Title, or an unmonitored episode of a Series, is not upgraded.

Example: you import a 1080p WEB-DL of a new film. Weeks later a BluRay Release with a higher Score appears, and Kestrel grabs it and replaces the file.

## Views and the Filter menu

Two ways to narrow a list that look alike and do different things. Both write into the same filter field, so what you pick shows there as text (`kind:errors`, `slot:4k`) and a bookmarked address (`?q=`) keeps it.

- **Views** are ready-made pages of a screen, in the side panel (on a phone, the first section of the Filter menu): the Log's Errors, Warnings and Grabs, Activity's In progress and Failed, Upcoming's Wanted when out and Recently out. You are on one View at a time, and each shows how many rows it holds. Choosing one replaces the filter with its own terms, and keeps only the sort.
- **The Filter menu** refines the View you are on. Each section (Kind, Slot and so on) lists values to tick. Ticking several values of one section shows rows that match any of them, and ticking in several sections shows rows that match all. Shift+click on a value excludes it (`-slot:4k`). The button counts the sections in use, and **Clear all** at the top empties the filter.

Example: in the Log, choose the **Errors** View for failures only, then tick **Slot > 4K** in the Filter menu to see the failures of 4K Versions. Choosing **Grabs** next starts over from that View.

## Requests

An ask from someone other than the admin, such as a person who shares your Plex server or a Silo user, for a Title in one or more Slots. A Request adds the Title or its missing Versions, and never changes existing ones. It carries who asked. You adding a Title yourself is not a Request. [Configuration](configuration.md#requesters-plex-sign-in) explains how people sign in.
