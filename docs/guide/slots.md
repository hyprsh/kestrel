# Slots

A Slot is one copy of a Title that Kestrel keeps as its own file. A Profile is the rule Kestrel follows to grab that copy. This page explains the difference, shows what you can do with your own Slots, and covers the upgrade to Kestrel releases that let you define them ([ADR 0024](../adr/0024-admins-define-the-slots.md)). [Concepts](concepts.md#slot) has the plain-words definition.

## Slot or Profile

- A **Slot** says which copy a Version is, and what its file is called. Its label is in the file name: `Dune (2021) {tmdb-438631} - [Standard][Bluray-1080p].mkv`.
- A **Profile** says which Release to grab: its resolution range, its language and its Scores. Profiles belong to no Slot, and any Profile can fill any Slot.

Because the two are separate, you can switch a Version from HD to Any, for a film with no HD Release, and the Version stays in its Slot. Its file is not renamed or moved. Silo tiers, Requests and "on for new Titles" all point at a Slot (the copy), never at a Profile (the rule).

Each Slot names a default Profile for Movies and one for Series. A new Version in that Slot follows it. Two Slots may share a default, but Settings warns about it: within one Title every Version has a different Profile, so the Title could use it in only one of them.

## What a Slot is for

Kestrel starts with two Slots, **Standard** and **4K**, and you can have up to four. Two examples that the old fixed pair could not do, since both want a second copy at a resolution another Slot already covers:

- **A Remux next to a streaming copy.** Keep Standard on HD and add a Slot named `Remux`, with `Any` as its default. A Title then holds a lossless 1080p file for the home cinema and a compact one for the tablet, at the same resolution.
- **A dub next to the Original Language.** Keep Standard on `HD Original` and add a Slot named `German`, with `HD` as its default. Each Title then holds both audio versions at 1080p, side by side.

Give two Slots different default Profiles, as here: a Title can't use one Profile in two Versions.

Which Version plays is still your media server's choice. A Slot carries no quality hint: Plex and Jellyfin pick by the file's real resolution.

**Kids and Mobile copies** can live in a Slot too, but they are usually better served by Silo: its request routes and per-device caps decide who gets what, without a copy of every Title for every audience. See [Silo requests](configuration.md#silo-requests-and-slots).

The rules, which Kestrel checks everywhere:

- At most four Slots, at least one, and at least one on for new Titles. Neither Standard nor 4K is special.
- A Title needs at least one Version in some Slot, and has at most one per Slot.
- A label is 1 to 24 letters, digits, spaces, `-` or `+`, unique ignoring case. The id of a Slot, such as `standard`, is fixed when it is made.
- The root folder stays per Title, not per Slot, so Plex, Jellyfin and Silo group a Title's Versions as one item.

## Managing Slots

Open Settings > Library > Slots. Each row shows the Slot's label, its default Profiles ("Movies HD, Series HD"), how many Versions it holds and its "on for new Titles" switch.

**Add a Slot.** Choose **Add Slot...** (hidden at four). Give it a label, which shows a preview of a file name, pick a default Profile for Movies and for Series (or None), and say whether new Titles get it. A new Slot reaches your existing Titles only if you tick **Also add to existing Movies / Series**, which shows how many of each. The new Versions start Wanted, and Kestrel searches them like the rest of the wanted list. A kind with no default Profile gets none. A Title that already uses that Profile in another Slot is skipped and counted in the message.

**Rename a Slot.** Choose **Edit...** and change the label. Kestrel shows "Renames N files" first, and then renames the Slot's files on disk, as it does when a Title's metadata changes ([ADR 0003](../adr/0003-fixed-naming-scheme-with-slot-labels.md)). The count is every file the Slot holds, whether or not its name changes. The old label stays as an alias that Adoption still recognises, so a file or an old backup that carries it is still matched to the Slot.

**Reorder.** Drag a row, or focus its handle and press the up and down arrow keys. The order is the order of chips, menus and filters everywhere in Kestrel, and Adoption uses it to guess a Slot.

**Delete a Slot.** Choose **Delete...** from the row's menu. Kestrel never merges a Slot into another, since a Title with files in both would need a rule nobody could guess. An empty Slot asks for one confirmation. A Slot with Versions shows how many hold a file, says that their files are deleted from disk, and asks you to type its label. The last Slot, the last Slot that is on for new Titles, and a Slot the [Config File](configuration.md#slots) declares can't be deleted.

If the Config File declares `slots`, every control here is read-only.

## How Slots work elsewhere

- **Adding a Title.** The add panel ticks the Slots that are on for new Titles and have an enabled default Profile. With one Slot in the library, the Slot controls disappear.
- **Requests.** A Request that names no Slot, such as one from a Plex Watchlist or a signed-in Requester, gets every Slot that is on for new Titles, each with its default Profile. Existing Versions are never changed.
- **Adoption.** Adoption reads a label only at its fixed place in the name, right after `<folder name> - `, and matches it to a Slot's label or one of its old labels. A file with no known label goes to the first Slot, in order, whose default Profile accepts the file's resolution, else to the first Slot. The review lists every guessed Slot.
- **One Release for two Versions.** When automatic search picks the same Release for two Versions of a Title, Kestrel downloads it once and hardlinks it under each Slot's label, so it takes no extra space on one mount. Scoring and upgrades still run per Version, and an Upgrade replaces only that Version's file. Activity shows one row, naming every Slot it fills. A manual Grab from the search screen stays one Version at a time.
- **Chips.** A Slot's chip shows its label in capitals when it is six letters or fewer, else its first three or more letters, lengthened until they differ. Standard, for example, now reads **STA**.

## Upgrading

Existing libraries keep what they had, and nothing on disk changes: no file is renamed or moved.

- The two Slots keep their ids (`standard`, `4k`), their labels and their defaults. Standard stays on for new Titles, and 4K stays opt-in. The 4K Slot now names `4k-primary` as its default for Movies and Series, where it used to have none unless you set one.
- Defaults moved from Profiles to Slots. The `default_movies` and `default_series` fields of a Profile are read-only and derived from the Slots in the API, and are ignored in the Config File's `profiles` section. To change a default, change the Slot.
- A Version can no longer share its Profile with another Version of the same Title. Adding a Version or switching a Profile that would clash answers `422 profile_taken`, and a bulk action skips the Title.
- A new Slot reaches an old Title only if you ask for it when you add the Slot.
- **API clients:** every Slot field changes from the enum `standard | 4k` to a string (the id). This is additive under [ADR 0009](../adr/0009-spec-first-openapi.md), but a generated client that matches the enum exhaustively needs regenerating. `GET /slots`, `POST /slots`, `PATCH /slots/{id}` and `DELETE /slots/{id}` are new. `Profile.slot` is deprecated, and `Request.slots` is optional.
- **Silo plugin:** `standard_profile` and `4k_profile` still work. See [Silo requests](configuration.md#silo-requests-and-slots).
