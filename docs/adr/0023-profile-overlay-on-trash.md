# A Profile's own settings sit on top of the TRaSH snapshot

A Profile used to be only its Slot, its audio rule and TRaSH's data: the qualities, their order, the Custom Formats, the Scores and the minimum Score all came from the backing TRaSH profile and could not be changed. Upgrades had no end ("there is no cutoff") and nothing limited a Release's size. Households asked for the things Radarr and Sonarr let them set: stop upgrading at a good-enough quality, ignore absurdly big or small files, drop a quality they never want. They did not ask to rewrite TRaSH's Custom Formats, which Kestrel re-reads daily.

So a Profile gets an **overlay**: a few nullable columns on the `profiles` row, applied when the TRaSH data is resolved into a `scoring.Profile` (`ProfileSpec.Overlay`). Null means "as TRaSH has it", or for the Cutoff and the sizes, no limit, so a Profile nobody edits behaves exactly as before and every migrated database keeps its behaviour.

- **Qualities.** The ladder (best first) and which qualities are accepted, per kind (Radarr and Sonarr name some qualities differently). Present, it replaces TRaSH's order and acceptance; qualities the list leaves out follow as TRaSH has them. A list equal to TRaSH's own is stored as none, so a later TRaSH change still reaches the Profile. "Reset to TRaSH" clears it.
- **Cutoff.** A Cutoff quality per kind and one Upgrade-until Score. A file has reached the Cutoff when its quality is the Cutoff quality or a better one in the ladder and its Score is at least the Upgrade-until Score; whichever of the two is unset is not checked, and with neither set the Profile never stops upgrading. Reaching it is computed when needed from the file's stored parse and Score, never stored, so editing the Profile applies at once and TRaSH updates (which change Scores) need no extra step. A file at its Cutoff is `Held.Done` in `acquire`: `Decide` leaves it alone and the Upgrade sweep marks the Version searched without asking the indexers. A missing, misfit or Original file is never done.
- **Size limits.** Smallest and largest bytes per Movie and per episode. `scoring.Evaluate` rejects a Release outside them as `size`; it is overridable like every rejection but `blocklisted`. A multi-episode Release and a season pack are judged per episode (the pack by the episodes the Library knows for that season; a pack of an unknown season is not judged). Imports and Adoption never judge size: a file on disk is not turned into a misfit by a limit.
- **Minimum Score.** An override of TRaSH's minimum Score, shown next to TRaSH's own value.
- **Custom Profiles.** "New Profile…" copies a Profile (its Slot, audio rule, heights, TRaSH backing and overlay) into a row marked `custom`. Custom Profiles can be renamed and deleted (refused while a Version uses one). They are never defaults, which keeps the Config File's rule that the defaults are among the builtin Profiles. The Config File still declares the six builtin Profiles as a whole and now ignores custom rows; while it declares `profiles`, creating, deleting and editing any Profile is refused (409), as editing was.

Saving an overlay re-scores the Versions under the Profile from what Import stored, the same step a Profile switch takes. It changes no Score today (the overlay does not touch Custom Formats), but it re-judges language and resolution fit and keeps the SPA's "Saving rescores N files" true.

## Considered Options

- **Copy TRaSH's data into Kestrel's own tables.** Rejected: it would freeze Profiles against TRaSH's daily updates, and the overlay is small.
- **Store the Cutoff state per file.** Rejected: it would go stale at every Score change, TRaSH update and Profile edit; the data to compute it is already on the file.
- **Edit Custom Format Scores.** Not done: Scores belong to TRaSH and the household's wish ("good enough") is met by the Cutoff and Upgrade-until Score.
- **One quality list for both kinds.** Rejected because Radarr names Remux qualities differently from Sonarr; the overlay keeps a list and a Cutoff per kind and everything else shared.

## Consequences

- `GET /profiles/details` carries the ladder, TRaSH's ladder, the Cutoff, the minimum Score, the overlay, `below_cutoff` and `rescores` per Profile; `POST /profiles`, `DELETE /profiles/{key}` and `PATCH /profiles/{key}` (`name`, `overlay`) are new. `GET /stats` carries `below_cutoff` for the Overview.
- `Release` in a manual search carries `size_limit`, and the `size` rejection says whether the Release is over or under.
- The Upgrade search of a Version whose files are all at the Cutoff costs no indexer request. "Search now" on such a Version finds nothing to upgrade; a manual search still lists and grabs what the user chooses.

**Note, from ADR 0026 and #304:** the Config File no longer declares only the six builtin Profiles and ignores custom rows. It may declare any set of Profiles, each from a recipe, and disables and keeps the stored Profiles it leaves out; it never deletes one.
