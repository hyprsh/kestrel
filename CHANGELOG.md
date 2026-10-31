# Changelog

## [0.11.0](https://github.com/hyprsh/kestrel/compare/v0.10.0...v0.11.0) (2026-10-31)

> The Library gets state tabs, rich rows and a poster grid, and you can type `harbour s2e5` to find an episode and search it right there. Activity becomes tabs that take over Health, the Overview gets leaner with poster shelves, and Needs attention now flags stuck downloads and Silo Requests that Silo stopped asking about.

### New Features

* **library:** the Library has state tabs with counts (Wanted, Long Missing, Downloading, Unreleased, Unmonitored), rows with a poster, size and a line saying why a Title is in its state ("Long Missing · Wanted for 96 days", "S05: 6 Wanted"), a Sort menu, and a poster grid with a summary panel (`g` switches). Tick boxes are always there, and a floating bar changes the ticked Titles while the Title stays open. Adopt and Clean up move to the "…" menu ([#271](https://github.com/hyprsh/kestrel/pull/271)), closes [#267](https://github.com/hyprsh/kestrel/issues/267)
* **library:** a Series' episodes are on season tabs, with Search and Manual search on every episode row and on each season instead of in a menu, and `s` and `m` from the keyboard. Find an episode takes `s2e5`, `2x05` or a name, and the Library filter does too: `harbour s2e5` or `harbour s2` lists that episode or season above the Titles, ready to search. Per-episode monitoring moves into the row and season menus ([#271](https://github.com/hyprsh/kestrel/pull/271)), closes [#268](https://github.com/hyprsh/kestrel/issues/268)
* **web:** the Log and Manual search page through long results, and their text columns (and the episode table's names) can be widened by dragging or with the keyboard. Each table remembers its widths in your browser and has "Reset column widths" ([#271](https://github.com/hyprsh/kestrel/pull/271)), closes [#269](https://github.com/hyprsh/kestrel/issues/269)
* **library:** Manual search shows only the Releases you can grab until you tick "Show rejected", and says how many it hides ([#271](https://github.com/hyprsh/kestrel/pull/271)), closes [#264](https://github.com/hyprsh/kestrel/issues/264)
* **activity:** Activity has Grabs, Health and Background jobs tabs. The Overview replaces its Health section and Searching card with status chips, shows Downloading now and Recent requests as compact rows, and Recently added and Coming this week as poster shelves ([#270](https://github.com/hyprsh/kestrel/pull/270)), closes [#261](https://github.com/hyprsh/kestrel/issues/261), [#265](https://github.com/hyprsh/kestrel/issues/265)
* **activity:** a download that is paused or hasn't moved for an hour shows as stuck in Activity and in Needs attention, with Search again and Cancel download ([#270](https://github.com/hyprsh/kestrel/pull/270)), closes [#249](https://github.com/hyprsh/kestrel/issues/249)
* **silo:** a Silo Request that Silo hasn't asked about for six hours shows in Needs attention, where you can open it, end it or dismiss it ([#270](https://github.com/hyprsh/kestrel/pull/270)), closes [#256](https://github.com/hyprsh/kestrel/issues/256)
* **web:** every row that stands for a Title shows its poster, including Needs attention, Activity's pipeline and Adoption matches ([#270](https://github.com/hyprsh/kestrel/pull/270)), closes [#262](https://github.com/hyprsh/kestrel/issues/262)
* **silo:** `kestrel-silo` can tell Silo's Autoscan which Title folders changed, through a scan source that reads Kestrel's new `GET /folder-changes` feed, instead of Silo guessing from the scan endpoint. See the guide's "Telling Silo about changed Title folders through Autoscan" ([#259](https://github.com/hyprsh/kestrel/pull/259))

### Bug Fixes

* **library:** `is:downloading` and the Downloading count now find Titles with a Grab on its way. Before, they never matched anything ([#271](https://github.com/hyprsh/kestrel/pull/271))

### Other Changes

* **settings:** "Seasons open by default" is gone from Settings > Display, since seasons are tabs now. `seasons_open` in the Config File is still accepted and ignored ([#271](https://github.com/hyprsh/kestrel/pull/271))

## [0.10.0](https://github.com/hyprsh/kestrel/compare/v0.9.0...v0.10.0) (2026-10-31)

> A Series' header now shows at a glance how much is on disk, downloading, wanted, missing for a long time and not monitored, and Manual search's "View in Activity" opens Activity on just the Grab you made.

### New Features

* **library:** a Series' coverage bar is split into what's on disk, downloading, Wanted, Long Missing and not monitored, each in its own color, so you can tell a Series that is downloading from one that is stuck ([#255](https://github.com/hyprsh/kestrel/pull/255)), closes [#247](https://github.com/hyprsh/kestrel/issues/247)
* **activity:** "View in Activity" after a Grab opens Activity filtered to that Grab. You can type the same filter yourself as `grab:<id>`, and the filter help lists it ([#255](https://github.com/hyprsh/kestrel/pull/255)), closes [#250](https://github.com/hyprsh/kestrel/issues/250)
* **web:** the Monitoring menu checks the option in use, and a Blocking problem's banner shows that its fix is running until it finishes ([#255](https://github.com/hyprsh/kestrel/pull/255)), closes [#254](https://github.com/hyprsh/kestrel/issues/254)

### Bug Fixes

* **library:** Slot dots in the Library and the episode grid no longer pop up a tooltip on hover ([#255](https://github.com/hyprsh/kestrel/pull/255)), closes [#254](https://github.com/hyprsh/kestrel/issues/254)

## [0.9.0](https://github.com/hyprsh/kestrel/compare/v0.8.1...v0.9.0) (2026-10-31)

> Kestrel now tells you what every action did, shows loading content in its own shape, and works on a phone in Manual search. Updating from TRaSH and changing the Primary Language run in the background with progress in Activity, and a new [documentation site](https://hyprsh.github.io/kestrel/) has guides for getting started, moving from Radarr and Sonarr, and troubleshooting.

### Upgrade Steps

* **[ACTION REQUIRED]** If a script calls `POST /api/v1/trash/update`, change it to expect `202 Accepted` and read the result from the `trash` job in `GET /api/v1/jobs` (see Breaking Changes).

### Breaking Changes

* **trash:** `POST /trash/update` returns `202 Accepted` at once and runs the update as a pass of the `trash` job, instead of answering `200 {changed, commit}`, `422` or `502` when it finishes. The job reports its progress and outcome (`updated`, `up_to_date`, `rejected`, `unreachable`, `rescored`, `failed`) in `GET /jobs`.
* **settings:** `PATCH /settings` with a new Primary Language returns with the old Language and `language_region.pending_primary_language` set. The new Language applies, together with re-scoring every file, when the background pass runs. If the re-score fails, nothing changes.

### New Features

* **trash:** "Update from TRaSH" and a Primary Language change re-score in the background. Activity → Background jobs shows "Re-scoring: N of M Titles", and a toast reports the outcome on any screen. Settings shows "Switching to German…" until the new Language applies, and no search or Grab ever sees a new Language with old Scores ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#244](https://github.com/hyprsh/kestrel/issues/244)
* **web:** every action gives feedback. Background work such as Search now says it started, with a link to Activity; changes you can't see on screen get a success toast; and failures always show ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#245](https://github.com/hyprsh/kestrel/issues/245)
* **web:** Skeletons in the shape of what's coming replace blank areas and "Loading…" lines, and posters fade in once loaded ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#197](https://github.com/hyprsh/kestrel/issues/197)
* **settings:** a Display section sets household-wide view defaults: season order (oldest or newest first), which seasons open, Manual search's sort and Upcoming's filters. Each can be declared in the Config File's new `display` section on its own ([ADR 0022](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0022-declared-display-settings-may-leave-others-to-the-ui.md)). Specials now come after the other seasons in both orders ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#190](https://github.com/hyprsh/kestrel/issues/190)
* **library:** Manual search works on phones as stacked rows, with a Sort menu in plain words ("Largest first", "Newest first") and the Grab bar above the tab bar. Grabbing shows "Grabbing…", a confirmation that stays with a link to Activity, and a Grabbed mark on the Release ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#188](https://github.com/hyprsh/kestrel/issues/188), [#237](https://github.com/hyprsh/kestrel/issues/237)
* **library:** a Series' header gives every Slot the same row, kept or not, and counts episodes that aren't monitored ("21 of 40 · 19 not monitored"). Monitoring is a button beside Search now that says its whole state, such as "Monitored: future episodes", and Search now is off while a Title isn't monitored ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#195](https://github.com/hyprsh/kestrel/issues/195), [#196](https://github.com/hyprsh/kestrel/issues/196)
* **overview:** a Blocking problem, such as an unreachable download client, shows as a banner on every screen with the action that fixes it. Health moves to the bottom and folds to one line while all is well, and Coming this week, Recently added and Recent requests show posters ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#191](https://github.com/hyprsh/kestrel/issues/191), [#201](https://github.com/hyprsh/kestrel/issues/201)
* **silo:** Silo's request page names Kestrel's step "Finding it", with "Searching" and "Downloading", and shows "Taking longer than usual" when an Import is stalled or a download is paused or hasn't moved for an hour ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#89](https://github.com/hyprsh/kestrel/issues/89)
* **docs:** a [documentation site](https://hyprsh.github.io/kestrel/) with guides for getting started, concepts, moving from Radarr and Sonarr, configuration, troubleshooting and the API, plus the glossary, decisions and changelog. About links to it ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#158](https://github.com/hyprsh/kestrel/issues/158), [#159](https://github.com/hyprsh/kestrel/issues/159)

### Bug Fixes

* **metadata:** cached TMDB posters are fetched again after 30 days or when a Title's poster changes, and none is kept past six months, as TMDB's terms require. Removing a Title removes its poster ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#63](https://github.com/hyprsh/kestrel/issues/63)
* **about:** the About page shows the TMDB logo beside its attribution, and the third-party notices list it ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#62](https://github.com/hyprsh/kestrel/issues/62)
* **overview:** Long Missing rows name the Profile ("HD") instead of its key, and a row no longer reads "4K · 4K" ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#160](https://github.com/hyprsh/kestrel/issues/160)
* **library:** the Library's Slot dots no longer look like spinners, and a Slot with no Version is a faint dot instead of a ring as loud as Wanted ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#198](https://github.com/hyprsh/kestrel/issues/198)

### Other Changes

* **repo:** Kestrel is licensed GPL-3.0-only, now with a `LICENSE` file, and `SECURITY.md` says how to report a vulnerability privately ([#248](https://github.com/hyprsh/kestrel/pull/248)), closes [#246](https://github.com/hyprsh/kestrel/issues/246)

## [0.8.1](https://github.com/hyprsh/kestrel/compare/v0.8.0...v0.8.1) (2026-10-29)

> Watch-ahead for Silo now counts Silo plays. In 0.8.0 every Silo catalog lookup was refused, so a Silo play never advanced a Request.

### Bug Fixes

* **silo:** Watch-ahead reads Silo's catalog as the API key's account's primary profile, or else one without parental limits, as Silo requires. Upgrading is all it takes ([#241](https://github.com/hyprsh/kestrel/pull/241))

## [0.8.0](https://github.com/hyprsh/kestrel/compare/v0.7.0...v0.8.0) (2026-10-29)

> A Series requested in Silo can now come one season at a time as it is watched, the way Watch-ahead already works for Plex Requesters, with plays on Plex and Silo counted together. It is off until you switch it on ([ADR 0020](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0020-watch-ahead-for-silo.md)).

### Upgrade Steps

* **[ACTION REQUIRED]** To use Watch-ahead for Silo, switch it on in Settings > Silo or declare `silo` in the Config File, and name the Silo media server instance whose playback history Kestrel reads. Its API key must be a Silo admin key (`sa_...`). Update the Kestrel plugin in Silo to get its Watch-ahead option ([#238](https://github.com/hyprsh/kestrel/pull/238))

### New Features

* **silo:** Watch-ahead for Silo. A Silo Series Request that names no seasons starts with season 1, and Kestrel adds the next season once anyone, on any Silo account or profile, has watched 2 episodes of the newest one. Plays on Plex count too while `plex_sign_in` has `watch_ahead` on. The Kestrel plugin in Silo has a Watch-ahead option (Kestrel default, On or Off) that Silo request routes can override, and a Silo user who asks for specific seasons gets them at once. `POST /requests` takes an optional `watch_ahead` for any source ([Watch-ahead for Silo](https://github.com/hyprsh/kestrel#watch-ahead-for-silo), [#238](https://github.com/hyprsh/kestrel/pull/238))

### Other Changes

* **web:** Plex sign-in and its switches moved from Settings > Security to their own Settings > Plex section, and the reverse proxy to Settings > Reverse proxy. Both, and the new Silo section, are in the Settings jump list and the phone's Settings list ([#238](https://github.com/hyprsh/kestrel/pull/238))

## [0.7.0](https://github.com/hyprsh/kestrel/compare/v0.6.0...v0.7.0) (2026-10-29)

> Kestrel can now turn what people add to their Plex Watchlist into Requests, fetch a requested Series one season at a time as it is watched, and mark requested Titles in Plex. Each of these is off until you switch it on ([ADR 0019](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0019-requests-from-plex-watchlists.md)).

### New Features

* **plex:** Four new switches in Settings > Security, or under `plex_sign_in` in the Config File, each off until set and each working only while Plex sign-in is on ([Requesters (Plex sign-in)](https://github.com/hyprsh/kestrel#requesters-plex-sign-in)). `watchlist` turns new entries on the Watchlists of the server owner and of friends who may request into Requests. A friend's Watchlist is read only once they make it visible, and nothing already on a Watchlist is requested. `watch_ahead` makes a Requester's Series Request start with season 1, then adds the next season once anyone has watched 2 episodes of the newest one. `labels` marks requested Titles in Plex with "Requested" and "Requested by <name>" labels and a "Requested" smart collection per section. `poster_badge` puts a "Requested" badge on their posters for `poster_badge_days` days (30 unless set), then restores the original poster. Turning a switch off takes back what Kestrel added in Plex. Plex keeps an uploaded badge image in the item's poster list, unselected, because it has no API to delete it ([#236](https://github.com/hyprsh/kestrel/pull/236))

## [0.6.0](https://github.com/hyprsh/kestrel/compare/v0.5.0...v0.6.0) (2026-10-26)

> The people you share your Plex server with can now sign in to Kestrel with their Plex account and ask for Movies and Series themselves, from the browser or the installed app, with no Seerr in between ([ADR 0018](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0018-requesters-sign-in-with-plex.md)).

### Upgrade Steps

* **[ACTION REQUIRED]** To offer Plex sign-in, set up a Plex plugin instance whose token is the Plex server owner's. Then switch sign-in on in Settings > Security > Plex sign-in, or declare `plex_sign_in` in the Config File (see "Requesters (Plex sign-in)" in the README). Kestrel must reach plex.tv over HTTPS. Behind a proxy that terminates TLS, list the proxy in `trusted_proxies` so the session cookie gets its `Secure` flag ([#234](https://github.com/hyprsh/kestrel/pull/234))
* Changing the admin password now logs out only the admin's other sessions. Requesters stay signed in. Log out everywhere and `kestrel reset-password` still end every session ([#234](https://github.com/hyprsh/kestrel/pull/234))

### New Features

* **requests:** Requesters sign in with their Plex account and can search Titles, make Requests and follow their own Requests, and nothing else. Kestrel lets in the Plex server's owner, its Plex Home members and the friends it is shared with. You can narrow that to a list of `users`, and someone who loses access is signed out within the hour. A Requester's Request asks for the Standard Slot with the default Profile. It goes into the Root folder you set for that user, such as a kids' folder, or else the first one. The Requests screen and the Log show who asked ([#234](https://github.com/hyprsh/kestrel/pull/234))

## [0.5.0](https://github.com/hyprsh/kestrel/compare/v0.4.0...v0.5.0) (2026-10-24)

> Kestrel now works on a phone, with a tab bar and an app you can add to the home screen, and a new Activity screen shows every Grab from search to Import alongside what Kestrel is running right now. It also grabs episodes and Movies before their metadata is complete, can hold an Original-Language Release back for your approval, handles Adoption of large libraries, and builds every screen from @hyprsh/design ([ADR 0017](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0017-kestrel-adapts-to-hyprsh-design.md)).

### Upgrade Steps

* **[ACTION REQUIRED]** If Kestrel sits behind a reverse proxy that terminates TLS and `trusted_proxies` is empty, list the proxy in `trusted_proxies`, in Settings > Security or under `reverse_proxy` in the Config File. Set `enabled: false` there unless you want header login. Kestrel now believes `X-Forwarded-Proto` only from a trusted proxy, so without this the session cookie silently loses its `Secure` flag ([ADR 0016](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0016-trusted-proxies-are-separate-from-header-login.md), [#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#106](https://github.com/hyprsh/kestrel/issues/106)
* In the Config File, a Profile's `original_language` (`reject`, `offer` or `accept`) replaces `original_fallback`. `original_fallback` still works (`true` is `accept`, `false` is `reject`), so the file only needs changing when you want `offer` ([#153](https://github.com/hyprsh/kestrel/pull/153)), closes [#103](https://github.com/hyprsh/kestrel/issues/103)
* Upgrading removes any media server "refresh failed" row in Needs attention that older releases could never clear. If refreshes still fail, the next failure raises a new row for that one server ([#200](https://github.com/hyprsh/kestrel/pull/200)), closes [#165](https://github.com/hyprsh/kestrel/issues/165)

### New Features

* **web:** Kestrel works on a phone. A floating tab bar holds Overview, with the Needs attention count, Library, Upcoming, Activity and More, which has Settings, the Log, About, the theme and signing out. The Search button beside the bar opens the command menu. A Title opens full screen with a back button, the Library's filters fold into a Filter row, tap targets are at least 44px and nothing is hover-only. Add Kestrel to your home screen to use it as an app ([#179](https://github.com/hyprsh/kestrel/pull/179), [#186](https://github.com/hyprsh/kestrel/pull/186)), closes [#121](https://github.com/hyprsh/kestrel/issues/121), [#181](https://github.com/hyprsh/kestrel/issues/181)
* **web:** Settings, Adoption, Clean up and the Log fit a phone too. Settings opens as a list of its sections, each with a back button, and rows, filters and confirmations stack with full-width actions ([#180](https://github.com/hyprsh/kestrel/pull/180)), closes [#134](https://github.com/hyprsh/kestrel/issues/134)
* **activity:** a new Activity screen lists every Grab from search to Import, grouped by stage: Searching, Queued, Downloading, Post-processing, Importing, Stalled, Done and Failed. Each row shows the poster, Slot, episodes, Release, indexer, Score, size and speed, and how long the Grab has been in its stage. Done and Failed reach back 7 days, and older Grabs are in the Log ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#129](https://github.com/hyprsh/kestrel/issues/129)
* **activity:** Activity's Running now shows Adoption, Imports and the Background jobs at work. Background jobs lists each job's schedule and its last and next run, with Run now for Search, RSS, Refresh and Health. A job that's switched off says which setting turns it off ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#126](https://github.com/hyprsh/kestrel/issues/126)
* **web:** the top bar shows what Kestrel is doing, such as "Searching 15/40" or "Scanning for files to adopt 120/450", and clicking it opens Activity ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#107](https://github.com/hyprsh/kestrel/issues/107)
* **overview:** a Searching card shows what is due now, in this pass and in the next, with each indexer's budget and any pause. After Search all Wanted, a toast says how many Wanted Versions were queued ([#162](https://github.com/hyprsh/kestrel/pull/162), [#226](https://github.com/hyprsh/kestrel/pull/226)), closes [#118](https://github.com/hyprsh/kestrel/issues/118)
* **overview:** each section shows five rows with its count and a "View all" link to the full list. Downloading now shows posters and opens the Title on click, and a Title page lists the Title's own active Grabs, with Cancel ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#122](https://github.com/hyprsh/kestrel/issues/122), [#116](https://github.com/hyprsh/kestrel/issues/116)
* **requests:** Recent requests on the Overview shows who asked and through what, the seasons asked for and a status per Slot, and a rejected Request says why. Its "View all" opens a Requests screen that filters by status, requester and source ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#128](https://github.com/hyprsh/kestrel/issues/128)
* **overview:** from 1024px wide the Overview has two columns under Needs attention. Health shows one tile per item with its state in words and failing items first, with meters for each indexer's search budget and each disk's free space ([#178](https://github.com/hyprsh/kestrel/pull/178)), closes [#164](https://github.com/hyprsh/kestrel/issues/164)
* **upcoming:** Upcoming is a timeline around today, from two weeks back to two months ahead, and Show earlier and Show later reach further. Each episode and Movie release shows where it stands in each Slot: not out yet, Wanted, downloading or Imported. Episodes on the same day are grouped, and Titles with no date yet follow at the end. Filter by kind, Wanted only or Hide imported, and move with j/k, Enter, `o` for an overview and `t` for today. Coming this week on the Overview shows the same state ([#174](https://github.com/hyprsh/kestrel/pull/174)), closes [#155](https://github.com/hyprsh/kestrel/issues/155)
* **library:** the Library's filter is one field with qualifiers, such as `is:wanted slot:4k` or `sort:wanted_since`, in place of the Kind tabs and the Wanted, Long Missing and Sort chips. Free text matches fuzzily, word by word ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#161](https://github.com/hyprsh/kestrel/issues/161)
* **log:** the Log's filter is one field with qualifiers (`kind:`, `slot:`, `title:`, `routine:`), commas for any of several values and `-` to leave matches out. It suggests values as you type, and "?" explains the syntax ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#123](https://github.com/hyprsh/kestrel/issues/123)
* **web:** dropdowns next to the filter field set filters without typing them: State, Slot, Profile and Sort in the Library, Kind and Title in the Log, Stage with its counts in Activity, and Requester and Source in Requests. Each dropdown writes its terms into the field, so typing and ticking stay in step ([#189](https://github.com/hyprsh/kestrel/pull/189)), closes [#183](https://github.com/hyprsh/kestrel/issues/183)
* **web:** every screen has its own address, such as `/activity` or `/library?q=is:wanted`, so a reload, a bookmark or a shared link opens the screen with its filter ([#162](https://github.com/hyprsh/kestrel/pull/162))
* **web:** the ⌘K menu shows posters for Library Titles and ranks fuzzy matches, so `bb` finds Breaking Bad. Add Title forgives years, accents and typos, and offers "Did you mean …?" when a search is misspelt ([#162](https://github.com/hyprsh/kestrel/pull/162)), closes [#154](https://github.com/hyprsh/kestrel/issues/154)
* **library:** Movies and Series share one Title page layout. A status line under the title gives each Slot's state, with a progress bar and Wanted and Long Missing counts for a Series. The action row holds Search now, Manual search and a Monitor dropdown, and Refresh and Freeze metadata move into the "…" menu. Each Version is one compact row with Change Profile, Remove Version and Delete file in its own "…" menu, and a Slot without a Version is one row with an Add Version dropdown ([#177](https://github.com/hyprsh/kestrel/pull/177), [#193](https://github.com/hyprsh/kestrel/pull/193)), closes [#167](https://github.com/hyprsh/kestrel/issues/167)
* **library:** a Movie's Version row shows its file's name on disk instead of the release name. Click it to see the full path with Copy path, and the Release it was grabbed as ([#177](https://github.com/hyprsh/kestrel/pull/177)), closes [#166](https://github.com/hyprsh/kestrel/issues/166)
* **library:** Manual search sorts by any column, and by total points for Custom Formats. Click a Custom Format to pin the Releases that have it to the top. Rejected Releases stay below the others, and the sort and pin last for the browser session. An episode Release shows its episodes' titles in your Primary Language, such as "S01E03 · The Pilot" ([#175](https://github.com/hyprsh/kestrel/pull/175)), closes [#152](https://github.com/hyprsh/kestrel/issues/152)
* **grabs:** an episode that TheTVDB lists without an air date counts as released once a later episode of its Series is out, so it becomes Wanted and a season with an undated finale gets its pack. A Movie with no release date anywhere becomes Wanted once a Release for it turns up, and is searched on add and then weekly ([#153](https://github.com/hyprsh/kestrel/pull/153)), closes [#76](https://github.com/hyprsh/kestrel/issues/76), [#79](https://github.com/hyprsh/kestrel/issues/79), [#81](https://github.com/hyprsh/kestrel/issues/81)
* **grabs:** a Release that names an episode TheTVDB doesn't list yet, at most two past the last listed one of a monitored season, is grabbed and imported as a Placeholder Episode. It shows TBA until a metadata refresh adopts its name and air date, and a refresh removes it while it holds no file. Manual search says why such a Release waits: an unlisted episode can be grabbed with an override, an unlisted season can't ([ADR 0013](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0013-placeholder-episodes-before-thetvdb-lists-them.md), [#153](https://github.com/hyprsh/kestrel/pull/153)), closes [#80](https://github.com/hyprsh/kestrel/issues/80)
* **profiles:** a Primary-Language Profile can offer a Release that has the Title's Original Language but no Primary-Language audio, instead of only rejecting or grabbing it. Set "Original Language only" to Offer for approval, and each Original Offer waits under "Originals available" in Needs attention and on the Title page for Accept or Dismiss. An accepted original fills the Version until any acceptable Primary-Language Release replaces it, whatever the Scores. Existing Profiles keep their behaviour ([#153](https://github.com/hyprsh/kestrel/pull/153)), closes [#103](https://github.com/hyprsh/kestrel/issues/103)
* **adoption:** the plan loads its rows a page at a time and keeps its filter. Select a row, every row shown or every row in the filter, then Adopt, Don't adopt, Accept suggested matches or Set monitoring for all of them at once ([#202](https://github.com/hyprsh/kestrel/pull/202)), closes [#112](https://github.com/hyprsh/kestrel/issues/112)
* **adoption:** a Needs choice row offers Kestrel's Suggested match, ranked by title, year and runtime, as its first button. Accept suggested matches settles only the Confident ones ([#202](https://github.com/hyprsh/kestrel/pull/202)), closes [#112](https://github.com/hyprsh/kestrel/issues/112)
* **adoption:** adopt Titles unmonitored by choosing all, future or no episodes for the plan, a row or a selection. A Title Kestrel already tracks keeps its own monitoring ([#202](https://github.com/hyprsh/kestrel/pull/202)), closes [#131](https://github.com/hyprsh/kestrel/issues/131)
* **adoption:** progress names the entry being worked on, such as "Adopting Paddington (2014) — moving 2 files". After a commit the rows stay, each with its Outcome, until the next scan, so the final screen lists what failed, was skipped, wasn't chosen or was left out. Try again re-plans the failed entries and Reopen brings back the rows nobody chose, neither with a new scan ([#202](https://github.com/hyprsh/kestrel/pull/202)), closes [#124](https://github.com/hyprsh/kestrel/issues/124)
* **adoption:** a waiting Adoption plan gets a Needs attention row, and Settings and the command menu say "Review the Adoption plan" while it waits ([#202](https://github.com/hyprsh/kestrel/pull/202)), closes [#132](https://github.com/hyprsh/kestrel/issues/132)
* **settings:** indexers, the download client and media servers are compact rows with their name, type, priority, an enabled toggle and their last check. Edit and Add open the form in place. Root folders read as a list until you edit them ([#176](https://github.com/hyprsh/kestrel/pull/176), [#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#136](https://github.com/hyprsh/kestrel/issues/136)
* **settings:** switch a plugin instance the Config File declares on and off in the UI, as long as the file leaves its `enabled` out. Kestrel keeps your choice across restarts, and an `enabled` the file sets is still enforced ([#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#135](https://github.com/hyprsh/kestrel/issues/135)
* **health:** Kestrel checks its external connections on a schedule. Each enabled media server is tested every 15 minutes: rejected credentials raise a Needs attention row at once, and other errors raise one on the second failure in a row. Each metadata provider gets one call an hour when nothing else called it ([#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#137](https://github.com/hyprsh/kestrel/issues/137)
* **indexers:** a Newznab indexer takes a Grabs per day limit, for indexers that cap downloads but not searches. At the limit its Grabs pause until the next UTC midnight and another indexer's Release can win, while searches and RSS carry on. The count survives a restart, the health strip shows the budget, and a quota the indexer reports itself takes precedence ([#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#65](https://github.com/hyprsh/kestrel/issues/65)
* **security:** `trusted_proxies` works without header login. Kestrel takes the client address from a trusted proxy's `X-Forwarded-For`, so the login throttle counts each client behind the proxy on its own, and `Remote-User` login still needs `enabled` ([ADR 0016](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0016-trusted-proxies-are-separate-from-header-login.md), [#192](https://github.com/hyprsh/kestrel/pull/192)), closes [#106](https://github.com/hyprsh/kestrel/issues/106)
* **web:** every screen is built from @hyprsh/design, so cards, badges, links, the j/k cursor and the accent colour look the same everywhere, and body text is 14px. Controls are a little larger and Settings stacks each row as a card, so screens are taller. Slot dots are larger rings and no longer pulse while downloading ([ADR 0017](https://github.com/hyprsh/kestrel/blob/main/docs/adr/0017-kestrel-adapts-to-hyprsh-design.md), [#170](https://github.com/hyprsh/kestrel/pull/170), [#173](https://github.com/hyprsh/kestrel/pull/173), [#187](https://github.com/hyprsh/kestrel/pull/187), [#203](https://github.com/hyprsh/kestrel/pull/203), [#226](https://github.com/hyprsh/kestrel/pull/226)), closes [#169](https://github.com/hyprsh/kestrel/issues/169), [#205](https://github.com/hyprsh/kestrel/issues/205)
* **web:** removing a Title or a Version, deleting files, deleting Unmanaged files in Clean up, moving a Title and any Needs attention action that asks first now confirm in a dialog, instead of an inline panel or the browser's own prompt ([#170](https://github.com/hyprsh/kestrel/pull/170), [#226](https://github.com/hyprsh/kestrel/pull/226)), closes [#205](https://github.com/hyprsh/kestrel/issues/205)
* **overview:** a Needs attention row shows its first action as a button and puts the rest in a menu ([#226](https://github.com/hyprsh/kestrel/pull/226)), closes [#205](https://github.com/hyprsh/kestrel/issues/205)
* **web:** a disabled menu item says why, such as "Nothing here is Wanted" or "No file to delete" ([#173](https://github.com/hyprsh/kestrel/pull/173))
* **web:** in the ⌘K menu the arrow keys wrap around and skip rows that can't be added, and the footer of key hints is gone ([#170](https://github.com/hyprsh/kestrel/pull/170), [#226](https://github.com/hyprsh/kestrel/pull/226))

### Bug Fixes

* **media servers:** a Title folder change made in the last seconds before Kestrel stops still reaches the media servers. Refreshes still waiting are sent at shutdown, so stopping can take up to 5 seconds longer ([#157](https://github.com/hyprsh/kestrel/pull/157))
* **health:** a passing Test, on a Needs attention row or in Settings, clears the indexer, download client or media server row it was run for, also after a restart, and says "Test passed" in a toast. A failing one says "Test failed: …". A media server's refresh failure is raised per server, so one server's passing Test clears only its own row ([#200](https://github.com/hyprsh/kestrel/pull/200)), closes [#165](https://github.com/hyprsh/kestrel/issues/165)
* **health:** Needs attention rows for a media server, download client or indexer name the instance once, instead of reading like "Jellyfin rejected Kestrel's credentials: Jellyfin rejected the credentials" ([#192](https://github.com/hyprsh/kestrel/pull/192))
* **library:** Add Version for a Series picks the Series default Profile, not the Movies one ([#193](https://github.com/hyprsh/kestrel/pull/193))
* **web:** a touch screen no longer shows the Library list's key hints ([#199](https://github.com/hyprsh/kestrel/pull/199))

### Other Changes

* **grabs:** an episode is released at its air time in its network's time zone, not at midnight UTC on its air date, so it becomes Wanted, is searched and turns Long Missing from then. A 21:00 New York episode is searched from 01:00 UTC the next day. A Series without a known air time behaves as before, and existing Series get their air time on their next metadata refresh ([#174](https://github.com/hyprsh/kestrel/pull/174)), closes [#155](https://github.com/hyprsh/kestrel/issues/155)

## [0.4.0](https://github.com/hyprsh/kestrel/compare/v0.3.1...v0.4.0) (2026-10-20)

> Kestrel now works on one episode, one season or many Titles at once: search or delete a single episode's file, tick Titles in the Library and change them together, and pause automatic Grabs. The Title page, the episode grid and Add Title show far more, from TMDB's Rating and linked IDs to episode titles in your Primary Language and a series overview before you add.

### New Features

* **library:** tick several Titles (`x`, shift-click, "Tick all shown") and change them together: monitor or unmonitor, switch Profile, add or remove a Version, Search now, refresh, freeze, or remove them from the Library. Each Title reports changed, skipped or failed, and why ([#145](https://github.com/hyprsh/kestrel/pull/145)), closes [#114](https://github.com/hyprsh/kestrel/issues/114)
* **library:** a Movie can be unmonitored from its Title page. An unmonitored Movie is never Wanted, searched or Upgraded. Unmonitoring a Series in bulk sets its Monitor mode to none ([#145](https://github.com/hyprsh/kestrel/pull/145)), closes [#70](https://github.com/hyprsh/kestrel/issues/70)
* **settings:** Pause Grabs stops every automatic Grab while searches keep running, and the health strip says so. Use it while you change indexers or Profiles. Grabs you start by hand still go through, and turning it off makes everything found in the meantime due for the next sweep ([#145](https://github.com/hyprsh/kestrel/pull/145)), closes [#70](https://github.com/hyprsh/kestrel/issues/70)
* **library:** Search now and Manual search for one episode, a season, a whole Series or a Movie, from the episode grid's ⋯ menus, a ticked selection or the Title page. Search now runs at once as a search started by hand: indexer pauses and Pause Grabs still apply, the daily budget stop doesn't. What it grabbed, or that it found nothing, shows in the Log ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#127](https://github.com/hyprsh/kestrel/issues/127)
* **library:** delete one episode's, one season's or one Movie's file and keep the Version, for a bad encode or the wrong language. The episode stays monitored, so it's Wanted again. A file that holds several episodes is deleted whole, and the confirmation names every episode that loses it. "Delete and blocklist this Release" stops the same Release being grabbed again; files Kestrel didn't grab can't be blocklisted ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#130](https://github.com/hyprsh/kestrel/issues/130)
* **library:** move a Title to another Root folder of its kind from the Title page's "…" menu. Its folder, files and subtitles move together and media servers hear about both folders. The Root folders must be on the same filesystem; Kestrel refuses a move across filesystems or onto an existing folder of the same name ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#78](https://github.com/hyprsh/kestrel/issues/78)
* **web:** the Title page puts its actions in one row under the description, with Clean up, Move and Remove in a "…" menu. The Standard and 4K cards sit side by side, and a Series' card shows its coverage, such as "55 of 63 episodes · 115.7 GB · 8 Wanted", which scrolls to the episode grid ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#117](https://github.com/hyprsh/kestrel/issues/117)
* **web:** the episode grid collapses seasons, each with a per-Slot summary. Specials and finished seasons start closed, the latest season and any with Wanted episodes start open, and what you open or close is remembered per Series in the browser ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#125](https://github.com/hyprsh/kestrel/issues/125)
* **library:** episodes show their title in your Primary Language with the original beneath, fetched from TheTVDB on the metadata refresh. Clicking a filled episode shows its file's path with a Copy button. Existing Series get translated titles on their next refresh ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#115](https://github.com/hyprsh/kestrel/issues/115)
* **web:** a Title's TMDB, IMDb and TheTVDB IDs link to the Title on those sites ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#119](https://github.com/hyprsh/kestrel/issues/119)
* **library:** TMDB's audience Rating, such as "TMDB 8.4 (21k)", shows on Title pages and in Add Title's results and panel. It is stored with the Title and refreshed with its metadata, so existing Titles show it after their next refresh ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#120](https://github.com/hyprsh/kestrel/issues/120)
* **web:** Add Title shows posters in its results, and the add panel shows the poster, description, runtime, genres and age rating. For a Series it shows whether it's running, its network, air dates and a season list, loaded from TheTVDB without holding up the panel ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#108](https://github.com/hyprsh/kestrel/issues/108)
* **library:** add a Series by season: just the first season to try a show, the latest season to join a running one (and follow new seasons), or the seasons you pick, with a toggle for whether new seasons are monitored ([#146](https://github.com/hyprsh/kestrel/pull/146)), closes [#108](https://github.com/hyprsh/kestrel/issues/108)
* **web:** the Library opens Adoption from an Adopt button next to a smaller Clean up button. It shows the stored plan, if there is one, without starting a scan ([#113](https://github.com/hyprsh/kestrel/pull/113))

## [0.3.1](https://github.com/hyprsh/kestrel/compare/v0.3.0...v0.3.1) (2026-10-20)

> Silo's request route dialog no longer crashes when one of Kestrel's dropdowns opens, so a route can pick a Profile and a Root folder again.

### Upgrade Steps

* **[ACTION REQUIRED]** Update the Kestrel plugin in Silo to 0.3.1. The route dialog fix ships in the plugin, so pulling the new image alone does not fix it.

### Bug Fixes

* **silo:** the Standard Profile, 4K Profile and Root folder dropdowns open in Silo's request route dialog instead of crashing it. "Kestrel default" is now stored as `default`, and connections saved with the old empty value keep working ([#104](https://github.com/hyprsh/kestrel/pull/104))
* **web:** clicking the Kestrel logo at the top of the rail goes back to the Overview ([#105](https://github.com/hyprsh/kestrel/pull/105))

## [0.3.0](https://github.com/hyprsh/kestrel/compare/v0.2.0...v0.3.0) (2026-10-20)

> Kestrel can now be set up from a file: point `KESTREL_CONFIG_FILE` at a YAML Config File, and every start brings the account, settings, Profiles, download clients and indexers to the state it declares, with no clicks in the UI. See [The Config File](https://github.com/hyprsh/kestrel#the-config-file).

### New Features

* **config:** declare the account, language and region, root folders, reverse proxy, GitHub update check, Profiles and plugin instances in a YAML file named by `KESTREL_CONFIG_FILE`. Use it when Kestrel should come up the same way on every deployment. Kestrel checks the whole file before it writes anything, and an unknown key or invalid value stops startup with its line number. Secrets are named by environment variable (`api_key_env: SABNZBD_API_KEY`) and never written in the file. An instance removed from the file is deleted on the next start, and `enabled` is enforced, so switching an instance off means editing the file and restarting ([#97](https://github.com/hyprsh/kestrel/pull/97)), closes [#91](https://github.com/hyprsh/kestrel/issues/91)
* **web:** everything the Config File declares is shown read-only, with a note to change it in the file. The API refuses those writes with 409 and reports `from_config_file` for each section and instance, and `kestrel reset-password` refuses a declared account ([#97](https://github.com/hyprsh/kestrel/pull/97))

### Bug Fixes

* **silo:** Silo's Test button now reports a Kestrel with an incompatible API version instead of showing "Connected" ([7d18007](https://github.com/hyprsh/kestrel/commit/7d18007f5337fea00fb5003a17ba9a9bdd4a8756)), closes [#87](https://github.com/hyprsh/kestrel/issues/87)


## [0.2.0](https://github.com/hyprsh/kestrel/compare/v0.1.0...v0.2.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* show Standard and 4K Slots in the SPA and update the docs
* two Slots, Standard and 4K, instead of SD, HD and UHD in the backend
* Settings loses kids_rule and root_folders.kids_*, Profile loses kids, the kids-* Profile keys become any-*, and SuggestedSlot.reason no longer has kids_rule.

### Features

* **api:** take a fixed API key from KESTREL_API_KEY ([f9ffeb3](https://github.com/hyprsh/kestrel/commit/f9ffeb360c9ebaa0ef50e192577b9a973482d970)), closes [#68](https://github.com/hyprsh/kestrel/issues/68)
* remove the Kids rule and Kids root folders, rename the Kids Profiles to Any ([7a313e1](https://github.com/hyprsh/kestrel/commit/7a313e1496ba42dabd0b9211bb15520b5b22ad57))
* **requests:** let a Request name the root folder of a Title it creates ([e512570](https://github.com/hyprsh/kestrel/commit/e5125701b598fab0b0c30b2d5e12468bb7ff862a))
* **settings:** a Kids root folder per kind for Titles the Kids rule catches ([677a759](https://github.com/hyprsh/kestrel/commit/677a759d8bfe508dc3750a1a3d2dea391d355532)), closes [#69](https://github.com/hyprsh/kestrel/issues/69)
* **settings:** a switch for Kids root folders with a path field per kind ([0a10f35](https://github.com/hyprsh/kestrel/commit/0a10f351276dc81cd4395ac6ff701d69d9886ae2))
* show Standard and 4K Slots in the SPA and update the docs ([c9bb388](https://github.com/hyprsh/kestrel/commit/c9bb388a40892dc90153cad271d813d68072e16c))
* **silo:** add standard_profile, 4k_profile and root_folder config and drop also_add_sd ([506aa14](https://github.com/hyprsh/kestrel/commit/506aa142f5b97a0db218eb6d5ec42c048965ad38))
* **slot:** add the Slot domain type, Standard and 4K ([67defe1](https://github.com/hyprsh/kestrel/commit/67defe19cb2606f5fc66d97164d7d62fbb71b864))
* two Slots, Standard and 4K, instead of SD, HD and UHD in the backend ([6cfc333](https://github.com/hyprsh/kestrel/commit/6cfc33394ce0f582419e56d2451357ea07bc4489))


### Bug Fixes

* **requests:** file a Title in the Kids root folder only when Kids is given ([7569eca](https://github.com/hyprsh/kestrel/commit/7569eca95aad3334f832206ec0ccc51cb3c11fd2))
* **silo:** name a host-less base URL as missing and tidy the catalog after review ([2b6d4b9](https://github.com/hyprsh/kestrel/commit/2b6d4b9058d4d69935a73b8b267e7f2a7e9ffe0c)), closes [#75](https://github.com/hyprsh/kestrel/issues/75)
* **silo:** write the catalog as Silo reads it and report the plugin's platforms ([66fbda7](https://github.com/hyprsh/kestrel/commit/66fbda7f3cebfd76fab74bf09f233ed2251a5c3b)), closes [#75](https://github.com/hyprsh/kestrel/issues/75)

## 0.1.0 (2026-10-18)


### Features

* **acquire:** decide which Releases to grab for each Version ([d607286](https://github.com/hyprsh/kestrel/commit/d6072868a9243008a4fef5fc087ef76fc441b0bc))
* **acquire:** grab and import Series episodes and season packs ([3fa47c3](https://github.com/hyprsh/kestrel/commit/3fa47c316e002ae4d70c4d76f8f8be0fcfa16861))
* **acquire:** heal failed downloads, rejected Imports and lost Grabs with Blocklist and retry ([fca60a9](https://github.com/hyprsh/kestrel/commit/fca60a95520962fab96622c598820688b3f5b9c9))
* **acquire:** manual search with the 6 h candidate cache, Grab records and the Blocklist ([da4368f](https://github.com/hyprsh/kestrel/commit/da4368fc7b2109bb63744dc2f7e7a68989cc9fd5))
* **acquire:** sync RSS feeds every 15 minutes and grab matches without searching ([8d856fa](https://github.com/hyprsh/kestrel/commit/8d856fa35bb8575abfff77a56ab5eb5669525673))
* add API key, reverse-proxy login and reset-password ([3b4bc7e](https://github.com/hyprsh/kestrel/commit/3b4bc7e1d9a7ae128fdc9099d4a877a641e2a4dc))
* add the Silo request router plugin ([c21185e](https://github.com/hyprsh/kestrel/commit/c21185eeee8643249a7a4fe3c642f82ef444bec8))
* add walking skeleton serving the empty Geist shell ([6fd67fb](https://github.com/hyprsh/kestrel/commit/6fd67fb253d4874b6b6791ff485bbea4c912eced))
* **api:** add account setup, login and 30-day sliding sessions ([5cdc43d](https://github.com/hyprsh/kestrel/commit/5cdc43d6d514a06efe2db7edcfa8fa5285ae0367))
* **api:** add lookup and Titles endpoints, TMDB key from the environment and the build ([ccfecda](https://github.com/hyprsh/kestrel/commit/ccfecda435ed401015028d1e836988d8446c7030))
* **api:** add plugin instance storage, write-only secrets and the instance CRUD and test API ([35e8e25](https://github.com/hyprsh/kestrel/commit/35e8e25fac29463e1f92e54e4488379abe3a27fa))
* **api:** add POST /setup/complete that lists missing sections ([32374b3](https://github.com/hyprsh/kestrel/commit/32374b37a340b62f2eca9940e808bfd45d36cb3e))
* **api:** add root folders to settings, prefilled and checked on save ([6336c0c](https://github.com/hyprsh/kestrel/commit/6336c0c285fd92f18de311af3c39c54c3b7abf7d))
* **api:** add Series through TMDB and TheTVDB with monitoring and the episode heat map data ([c85683f](https://github.com/hyprsh/kestrel/commit/c85683f7d97ab74566e06fe9715243d0a7e9539b))
* **api:** attention and status read models, dismiss and the health wiring ([222eade](https://github.com/hyprsh/kestrel/commit/222eadecf216052d88a805fd0dac2635b7c52522))
* **api:** manual search and Grab endpoints with the quality rejection code ([49bc7e1](https://github.com/hyprsh/kestrel/commit/49bc7e1f0928483c1c047c241d3f5bd1d7822a20))
* **api:** Profiles and language settings endpoints, setup states for language and profiles ([4840cf7](https://github.com/hyprsh/kestrel/commit/4840cf72b049db6653fc9120e79c65ed182a6e38))
* check GitHub daily for updates and security fixes, and add About with third-party notices ([92a686a](https://github.com/hyprsh/kestrel/commit/92a686a8e14a608c9ba354628f2907143064db01))
* **downloads:** observers on download client and indexer calls ([2bd1a3a](https://github.com/hyprsh/kestrel/commit/2bd1a3a735c448d838eded41f8baffbe62524974))
* **downloads:** send NZBs to the enabled download client in the Movie or Series category ([19ff729](https://github.com/hyprsh/kestrel/commit/19ff7291d11528d723f3cb9eb8df7ab390383cb9))
* **health:** health_issues with Raise and Clear and the periodic checks ([deadac3](https://github.com/hyprsh/kestrel/commit/deadac3104f8bd64131f8d83e548d674ae275aaa))
* **history:** live UI through the events log and an SSE stream ([ee8d3fc](https://github.com/hyprsh/kestrel/commit/ee8d3fcc97e1aeae59a78e2bf6e815c2512f6ace))
* **imports:** add the pure naming function for the fixed scheme ([9f0373d](https://github.com/hyprsh/kestrel/commit/9f0373d0c4234f1acff8f20c27eeacf65eb9153c))
* **imports:** adopt Series, replacements and the wizard's Adopt step ([0e24145](https://github.com/hyprsh/kestrel/commit/0e241451b808846ae301bcb9296908e754b38fd4))
* **imports:** clean up Unmanaged files by category ([590abf5](https://github.com/hyprsh/kestrel/commit/590abf5500049534b0eba55386220a1f5ff9b733))
* **imports:** import a completed Movie download with ffprobe checks and crash-safe placement ([b9c02ce](https://github.com/hyprsh/kestrel/commit/b9c02ce10e56e531433860c792f67cacb2fef50e))
* **imports:** record Import events and hint the stream ([3c0b92c](https://github.com/hyprsh/kestrel/commit/3c0b92c0eb1b93c4354f6c1fb414d79cec5ed43a))
* **imports:** refresh Silo, Jellyfin and Plex after every change to a Title folder ([713bdb9](https://github.com/hyprsh/kestrel/commit/713bdb92c4980e0f3f09483951c0c16515a598b8))
* **imports:** scan, review and commit an Adoption of existing Movie files ([29ba7db](https://github.com/hyprsh/kestrel/commit/29ba7db22b3871241a6837c8a7f0b326ea6c50ea))
* **imports:** wait for an unavailable Root folder and warn on cross-filesystem copies ([24185e3](https://github.com/hyprsh/kestrel/commit/24185e36bf14558fa31a7b88f0bd3f6febe87751))
* **indexers:** respect API budgets, pause on 500, 501 and 429 and back off on errors ([d0036d7](https://github.com/hyprsh/kestrel/commit/d0036d754102135f7862a334c62ff175e70ca91c))
* **indexers:** search every enabled indexer in parallel with ID-to-text fallback and cached Caps ([e6973b7](https://github.com/hyprsh/kestrel/commit/e6973b7fb5d65a9061b31bca9318ce587cd6af7b))
* **jobs:** health check loop ([01c6a04](https://github.com/hyprsh/kestrel/commit/01c6a045db0df41082815c7d0cac6a62d32a76d0))
* **jobs:** refresh metadata daily, rename on title change and flag Titles gone upstream ([65a6792](https://github.com/hyprsh/kestrel/commit/65a67926bc896345e86d48e3303faa89b3c01eaa))
* **jobs:** search on add and track downloads with reconciler loops and a Downloading now overview ([910c960](https://github.com/hyprsh/kestrel/commit/910c9605a7966a5e06c596998da12ae2ec8c58e8))
* **jobs:** sweep Wanted Versions on a decaying cadence and filled ones for Upgrades ([baa98ff](https://github.com/hyprsh/kestrel/commit/baa98ff0c3c707254b8de886f9804e88b6685126))
* **library:** add Series with seasons, episodes and monitoring modes ([5a6003c](https://github.com/hyprsh/kestrel/commit/5a6003cf417240d0aa85866a3591df6548e24352))
* **library:** add Titles, Versions, files and search state for Movies, with the add-panel Suggestion ([a70b380](https://github.com/hyprsh/kestrel/commit/a70b3808cfec3586d63b654a2994d25386892d5f))
* **library:** add, switch Profile and remove Versions and Titles ([b359b8a](https://github.com/hyprsh/kestrel/commit/b359b8a5a33bd81ba6ca523288348cc921c77f34))
* **library:** refresh Title metadata and rename folders and files with it ([c580113](https://github.com/hyprsh/kestrel/commit/c580113d96961db109afdb0470cc300f1a325a6e))
* **metadata:** add a TheTVDB v4 client and the pure Wanted and monitoring functions ([820ac3c](https://github.com/hyprsh/kestrel/commit/820ac3c4ae7c452dfca5adf06235dd1e78def248))
* **metadata:** add a TMDB client with key precedence, release-date fallback and a poster cache ([73a6b32](https://github.com/hyprsh/kestrel/commit/73a6b324083b3038110dafe2d200407d1bd6b0db))
* **plugin:** add indexer.v1 contract and Newznab adapter ([4c7cf65](https://github.com/hyprsh/kestrel/commit/4c7cf650d506ed07be51d907c0d7c25f65da217e))
* **plugin:** add shared plugin infrastructure, download_client.v1 and the sabnzbd adapter ([b9b8080](https://github.com/hyprsh/kestrel/commit/b9b808010c3f8ba4acabaea44fb5eedea7819c4a))
* **probe:** read downloads with ffprobe and apply the probe rules ([93dec65](https://github.com/hyprsh/kestrel/commit/93dec65abe1dedd7be06e6449b46a84b2f2f57bf))
* **profiles:** seed the eight Profiles with defaults, Profile resolution and the Kids rule ([410728b](https://github.com/hyprsh/kestrel/commit/410728bdd914f72893e96933e75b4d3a05ff40c6))
* **release:** parse Movie release names with a port of Radarr v5.28.0.10274 ([0e77299](https://github.com/hyprsh/kestrel/commit/0e772998826edcc45ce226f0e0f460a46b298c51))
* **release:** parse Series release names with a Sonarr parser port ([5faeca6](https://github.com/hyprsh/kestrel/commit/5faeca686bd54aa5ab0a1d632e829d713e20809e))
* **requests:** add the native Request API with derived per-Slot status and Requested-by on the Title detail ([26ec3e3](https://github.com/hyprsh/kestrel/commit/26ec3e371af2cf8ccb49d27676badb19bc998a78))
* **scoring:** discount a language named in the Title's own name like Radarr and Sonarr ([e12add2](https://github.com/hyprsh/kestrel/commit/e12add22f6b9b571b1b8988a72bea2a874ea32ee))
* **scoring:** evaluate Releases against TRaSH Custom Formats and Profile gates ([04a2e05](https://github.com/hyprsh/kestrel/commit/04a2e0592cbbe0cbafe40a478a6c7b31e2d72f3c))
* **scoring:** reject Releases whose quality the Profile does not allow ([42bcbb8](https://github.com/hyprsh/kestrel/commit/42bcbb8c754136fb7f258149cf9a81daaa153754))
* set the metadata provider keys from Settings ([7125035](https://github.com/hyprsh/kestrel/commit/71250358c45e1106d996a4e0383613ca1e21cd3f))
* **trash:** keep TRaSH current with an atomic, re-scoring update ([c2a2478](https://github.com/hyprsh/kestrel/commit/c2a2478b3c79c06afa48f16a40258e059c45c703))
* **upcoming:** list episodes and typed Movie release dates, and fill the Overview's Coming this week and Recently added ([5132475](https://github.com/hyprsh/kestrel/commit/51324756fabf32f585b7edb4902a9ef17bacf652))
* **web:** add Log and Blocklist screens with daily pruning of routine events and expired sessions ([9fad574](https://github.com/hyprsh/kestrel/commit/9fad574009870955f3c3da294920bc64a8a1f777))
* **web:** add Series from the command menu with monitoring and the episode heat map ([21f4a62](https://github.com/hyprsh/kestrel/commit/21f4a62c3feed04ace54aae7e861ecd87b687b4e))
* **web:** add the Adoption review screen ([067237b](https://github.com/hyprsh/kestrel/commit/067237b66829a165929962a3f6a49f89a645e7eb))
* **web:** add the command menu with Add, and the keyboard-driven Library with its Versions strip ([5730b60](https://github.com/hyprsh/kestrel/commit/5730b606a339c32562520b6a19dd8aa64524bac3))
* **web:** add the keyboard-driven manual search view with Grab and Grab anyway ([b01e44a](https://github.com/hyprsh/kestrel/commit/b01e44a9201ddcb80a15b7b31864c092ad094be3))
* **web:** add the manifest-driven plugin form for the wizard and Settings download client ([38deed9](https://github.com/hyprsh/kestrel/commit/38deed9ca2b849f9414ea37ea099cace75358ec4))
* **web:** add wizard Account step, login card, log out and Settings account section ([462ed74](https://github.com/hyprsh/kestrel/commit/462ed745c65cd7e1b08d7c11df6f5b5cb89d9caa))
* **web:** connect Newznab indexers in the wizard and Settings ([722828d](https://github.com/hyprsh/kestrel/commit/722828d3f6babd5278468880fd104a2ffffc21c6))
* **web:** Needs attention, the health strip and the rail badge ([367dc65](https://github.com/hyprsh/kestrel/commit/367dc6550bb7b18248302e51bee608da1bbe08f0))
* **web:** open Clean up from the Library, a Title and the Adoption result ([df6714e](https://github.com/hyprsh/kestrel/commit/df6714eb221d81a2d20ebfa7c276591f64a2436d))
* **web:** Primary Language and Profiles sections in the wizard and Settings ([a94ba16](https://github.com/hyprsh/kestrel/commit/a94ba1612e737632ad1bf0dc2c2b144ccfb2ca2b))
* **web:** root folders, folding wizard sections and Finish setup ([8396ab7](https://github.com/hyprsh/kestrel/commit/8396ab7645ba2210865b20e905219f4758f52d5f))


### Bug Fixes

* **acquire:** a known class the Profile does not accept is other_slot whatever Versions the Title has ([58ac9e6](https://github.com/hyprsh/kestrel/commit/58ac9e602e2c7cd6d3f482b006096a4449dbb033))
* **acquire:** decide a Release's fit per Version from its Profile's range, so SD fits both SD and Kids ([f6dc8d9](https://github.com/hyprsh/kestrel/commit/f6dc8d907ac61510befac0ae00b6b54745c06274))
* **acquire:** let a fitting Release replace a misfit file in RSS, Movies and Series ([1c77a8e](https://github.com/hyprsh/kestrel/commit/1c77a8e1dbb73efcdde98f446394bdf73bd6e7f6))
* **acquire:** note an inconclusive probe in the Log ([847decc](https://github.com/hyprsh/kestrel/commit/847deccd950d19db456d51bbccad395c4b89e1db))
* **acquire:** plan a pack that fills missing episodes despite a higher scoring held one ([682bc3f](https://github.com/hyprsh/kestrel/commit/682bc3f2446abed5312ed70eb38b85e98ccb9d1f))
* **acquire:** retry a failed Upgrade with the next best Upgrade ([7623798](https://github.com/hyprsh/kestrel/commit/7623798cb369b0f4a452dc7eccdc8734c821744a))
* **api:** limit Clean up to the Titles an Adoption adopted ([0625d8a](https://github.com/hyprsh/kestrel/commit/0625d8a6ba328a6890ef4eea0174bf723af38a93))
* **imports:** check the Root folder before a Series Import ([a2491d9](https://github.com/hyprsh/kestrel/commit/a2491d9071184e763073e25eacfbd4dd4882b9c4))
* **imports:** delete the replaced file when a crashed Import is finished ([20c1cdf](https://github.com/hyprsh/kestrel/commit/20c1cdfa3b9aed9497f2fad422c093bdb9af39d0))
* **imports:** flag adopted files that fail the Profile gates so their Version is Wanted ([809ad15](https://github.com/hyprsh/kestrel/commit/809ad1540f7366974041c5fe444890bebd0ae200))
* **imports:** re-score an Adoption's Titles at commit under the active snapshot ([8ac2b56](https://github.com/hyprsh/kestrel/commit/8ac2b56afc06dcca18c8302dae1ed58e3347ec8a))
* **imports:** score Adoption with the live TRaSH snapshot ([bdd92fb](https://github.com/hyprsh/kestrel/commit/bdd92fb211fe09a2738a31c50da8bed90c35bff0))
* **imports:** tell the media servers after Adoption and Clean up ([67b73b5](https://github.com/hyprsh/kestrel/commit/67b73b5d402e4a7158f4143f9815211373ec4563))
* **imports:** write the replaces marker before a Series Import commits ([71bcb67](https://github.com/hyprsh/kestrel/commit/71bcb675e4ba0b6128c9de253f1e1092c57dd686))
* **jobs:** run the update and TRaSH checks when the last run is over a day old ([d954762](https://github.com/hyprsh/kestrel/commit/d9547621d0d788a7b062bd00b8419ed943599ffb))
* **jobs:** search a new Version on add without the sweep's budget stop ([a229c46](https://github.com/hyprsh/kestrel/commit/a229c4689f78b9ea0fe9b5dbc98f28e2b2593895))
* **library:** keep adopted Versions out of the uncapped search on add ([3c20071](https://github.com/hyprsh/kestrel/commit/3c200715cc5790247610e9942852efa9072571da))
* **library:** leave adopted files out of Recently added and report the Score an Upgrade beat ([c6b510e](https://github.com/hyprsh/kestrel/commit/c6b510ea902a52bc844198d3b70a595ffcf986e0))
* **library:** read Upcoming typed dates in the one release-date country ([c8d7eeb](https://github.com/hyprsh/kestrel/commit/c8d7eebc21196d2d4b4b5b9776c491eeeb491e61))
* **metadata:** read a Movie's release date in one country, falling back only when it has no dates ([3fc953a](https://github.com/hyprsh/kestrel/commit/3fc953ae0e2677ca0ab3cea47ca817cf05613b50))
* **probe:** apply the runtime check or the duration floor, not both ([c3bf832](https://github.com/hyprsh/kestrel/commit/c3bf832c8e832e8574ba4383c4bcab4f98c51211))
* **requests:** a later Profile change does not reopen a completed Request ([8477c76](https://github.com/hyprsh/kestrel/commit/8477c7645b912e9a2796928f9a32b71d81ed3f28))
* **requests:** complete a Slot only once a fitting file filled it, and keep it completed ([ca8f77a](https://github.com/hyprsh/kestrel/commit/ca8f77a8d72b6c7bbaa2f8bda49ebda8442eb7bc))
* **requests:** evaluate a retried rejected Request again ([845107d](https://github.com/hyprsh/kestrel/commit/845107d63c22154bd136bb0926992f7b59b4364f))
* **scoring:** re-score stored files at startup when the active TRaSH snapshot changed ([a453a47](https://github.com/hyprsh/kestrel/commit/a453a4724d14d40a33e4bb143aa303c6ed0bddbf))
* **web:** make every Overview section keyboard-navigable and show release and score delta in Recently added ([053087e](https://github.com/hyprsh/kestrel/commit/053087e5a11a50443ab3ca156c3029caf84a8080))
* **web:** open Clean up over the adopted Titles only ([28f6d32](https://github.com/hyprsh/kestrel/commit/28f6d32340a58c4e6212d7b70ffa15e80bd3294e))
* **web:** open the Profile picker on demand in the Versions strip ([bf28fd2](https://github.com/hyprsh/kestrel/commit/bf28fd224a19fd6b3c7f20df108573aabb7bc437))
* **web:** type the notices handler and spell Long Missing as the glossary does ([21efd63](https://github.com/hyprsh/kestrel/commit/21efd63d1275783badba91ad42f25f0a8a8b374f))
