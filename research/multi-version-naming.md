# Multi-version naming in Plex, Jellyfin and Silo

Research for [#3](https://github.com/hyprsh/kestrel/issues/3). The question: how do Plex, Jellyfin and Silo each recognise several Versions of one Movie, and of one Series episode, in the same folder? Which ID tags does each one read? What does TRaSH recommend? Is there one naming scheme all three read correctly, including Dual-Language and quality labels?

Checked 2026-10-17 against:

- Plex support articles: [Naming movie files](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/) (last modified 2026-05-22), [Multi-Version Movies](https://support.plex.tv/articles/200381043-multi-version-movies/) (2022-08-22), [Multiple Editions](https://support.plex.tv/articles/multiple-editions/) (2026-07-07) and [Naming TV show files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/) (2026-09-28).
- Jellyfin server source, `master` at [`6f1053a`](https://github.com/jellyfin/jellyfin/tree/6f1053ad5f00cb5827a1a981226547e07bad589a). The functions cited below are the same in release `v12.2` (2026-10-05). Also the Jellyfin docs at [`ef4a076`](https://github.com/jellyfin/jellyfin.org/tree/ef4a07689f8e3672d8b1e841da979c44bbe97e62).
- Silo source: [Silo-Server/silo-server](https://github.com/Silo-Server/silo-server) at [`5d1ab2b`](https://github.com/Silo-Server/silo-server/tree/5d1ab2ba96c220f9218279d5b880f3afafa5861c) and the manual at [Silo-Server/siloserver.org](https://github.com/Silo-Server/siloserver.org) [`3dc3670`](https://github.com/Silo-Server/siloserver.org/tree/3dc3670cacc48cc229f27268c054f959c8d246fb).
- TRaSH Guides at [`14a4166`](https://github.com/TRaSH-Guides/Guides/tree/14a4166673996301e588a4f70d03b9cfb760b50f): the naming JSON that the Radarr and Sonarr naming pages render.

## Short answer

All three servers read one scheme correctly. Put a Plex-style ID tag in the Title folder name, and for Movies repeat the whole folder name at the start of every file. Then add ` - ` and a bracketed Version label:

```text
/data/media/movies/Dune (2021) {tmdb-438631}/
  Dune (2021) {tmdb-438631} - [HD][Bluray-1080p][German DL][DTS 5.1][x264]-GRP.mkv
  Dune (2021) {tmdb-438631} - [UHD][Bluray-2160p][German DL][TrueHD Atmos 7.1][DV HDR10][x265]-GRP.mkv

/data/media/tv/Show Name (2020) {tvdb-123456}/Season 01/
  Show Name (2020) - S01E01 - Pilot - [HD][WEBDL-1080p][German DL][EAC3 5.1][h264]-GRP.mkv
  Show Name (2020) - S01E01 - Pilot - [UHD][WEBDL-2160p][German DL][EAC3 5.1][DV HDR10][h265]-GRP.mkv
```

Things to avoid, because they break at least one server:

- **No `{edition-…}` tag in a Version's name.** Plex makes each edition its own library item, so the Versions would split apart.
- **No label glued straight onto the title.** Jellyfin needs `-`, `_`, `.` or a whole `[...]` group right after the folder-name prefix. Radarr's default `Movie (2021) Bluray-1080p` and the bare `Movie (2021) [Bluray-1080p]` both fail that check, and then Jellyfin groups no file in that folder.
- **No ID tag in the folder only.** For Movies, Jellyfin requires every file name to start with the full folder name, ID tag included.
- **Episode versions work in Jellyfin only from 12.0** (September 2026). Plex and Silo already group them.

## Plex

**Movie versions.** Files in one movie folder named `MovieName (Release Year) - ArbitraryText.ext` "will be collapsed to a single item in the library". Plex picks the most suitable file for the playing app, and some apps offer **Play Version** ([Multi-Version Movies](https://support.plex.tv/articles/200381043-multi-version-movies/)). Plex ignores the label text: "Plex will show you the actual resolution of the media … The text you have there is not displayed." The documented example is `Pulp Fiction (1994)/Pulp Fiction (1994) - 1080p.mkv` beside `Pulp Fiction (1994) - SD.m4v`.

**Editions are not Versions.** A file or folder carrying `{edition-Name}` (at most 32 characters, Plex Pass, Plex Movie agent 1.28.1+) becomes a separate library item, with its own watch state ([Naming movie files](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/), [Multiple Editions](https://support.plex.tv/articles/multiple-editions/)). To have several versions of one edition, each file in that edition's folder must carry the same `{edition-…}` tag. TRaSH warns about the same trap: a 1080p Director's Cut and a 2160p Theatrical "will appear as two separate items" ([TRaSH Radarr naming](https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/docs/Radarr/Radarr-recommended-naming-scheme.md)).

**Episode versions.** The Multiple Editions article says multi-version support merges "multiple different versions of the same underlying movie/episode". Episodes are matched by their `sXXeYY` code ("It does not matter if you use dashes, dots, or just spaces"). Editions are not supported for TV ([Naming TV show files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/)). The TV article also notes that text after the episode code is a matching hint for the Plex TV Series agent: "If you want info to be ignored put the optional info in brackets." Quality and language labels belong in `[...]`.

**ID tags.** Movies: `{imdb-tt…}` or `{tmdb-…}` in the folder and/or file name, in the form `{[source]-[id]}`, curly braces only. Series: `{tmdb-…}`, `{tvdb-…}` or `{imdb-tt…}` in the show folder name, also curly braces only. Plex also recommends the year in TV folder and file names.

## Jellyfin

**Movie versions.** Implemented in [`VideoListResolver.GetVideosGroupedByVersion`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Naming/Video/VideoListResolver.cs#L121) and [`IsEligibleForMultiVersion`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Naming/Video/VideoListResolver.cs#L180). It runs once per folder, and either all non-extra files in the folder group or none do:

1. Every file's year must be the same (`HaveSameYear`).
2. Every file name must start with the containing folder's name. The code compares case-insensitively (`OrdinalIgnoreCase`). The [docs](https://github.com/jellyfin/jellyfin.org/blob/ef4a07689f8e3672d8b1e841da979c44bbe97e62/docs/general/server/media/movies.md) say "character-for-character".
3. After that prefix is stripped and the [`CleanStrings`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Naming/Common/NamingOptions.cs#L152) regexes run, the rest must be empty, start with `-`, `_` or `.`, or be a complete `[...]` group.
4. If any file fails, the whole folder's files stay separate Movies.

The cleaning step cuts a remainder at its first release keyword. That is why `[Bluray-1080p]` with no separator fails: it is cleaned to `[Bluray`, which is not a complete bracket group. I checked this by re-implementing steps 2 and 3 in a small script, not by running Jellyfin. The results:

| File stem in `Dune (2021) {tmdb-438631}/` | Groups? |
| --- | --- |
| `Dune (2021) {tmdb-438631} - [UHD][Bluray-2160p]…` | yes |
| `Dune (2021) {tmdb-438631} UHD German DL` | no, `UHD` follows the prefix directly |
| `Dune (2021) - [UHD][Bluray-2160p]` | no, the ID tag is missing from the prefix |
| `Dune (2021) [Bluray-2160p]` in `Dune (2021)/` | no, cleaned to `[Bluray` |

Jellyfin's own tests agree on the separator forms: `- 2160p`, `-720p`, `_…` and `[test]` group ([`MultiVersionTests.cs`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/tests/Jellyfin.Naming.Tests/Video/MultiVersionTests.cs)). So does `[imdbid=tt6146586] - Version 1` after an ID-tagged folder name.

**Version order and default.** In [`OrganizeAlternateVersions`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Naming/Video/VideoListResolver.cs#L274), files whose name matches `[0-9]{2}[0-9]+[ip]` sort first, by resolution with the highest first. The rest follow alphabetically. The primary Version is a file named exactly like the folder, if there is one; otherwise it is the first in that order. So with the scheme above, UHD (2160p) sorts first in Jellyfin even though HD is Kestrel's default Profile.

**Version labels.** [`BaseItem.GetMediaSourceName`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/MediaBrowser.Controller/Entities/BaseItem.cs#L1289) labels each version with the part of its file name that differs from its siblings. [`GetCommonVersionPrefix`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/MediaBrowser.Controller/Entities/BaseItem.cs#L1419) moves the cut back to the last `-`, `_` or `.` in the shared prefix. This makes TRaSH's plain names show labels like `1080p][DTS 5.1][x264]-GRP`, because the shared prefix ends in `[Bluray-`. With ` - [HD]` / ` - [UHD]` first, the label starts cleanly: `[UHD][Bluray-2160p][German DL]…`.

**Episode versions (new in 12.0).** The 12.0 release notes list "Multiple versions for episodes" ([PR #16828](https://github.com/jellyfin/jellyfin/pull/16828)) and require a full library scan after upgrading. [`GetEpisodesGroupedByVersion`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Naming/Video/VideoListResolver.cs#L207) groups files in one season folder by their non-optimistic `S{n}E{n}` (or air-date) key. There is no prefix rule for episodes. Releases before 12.0 (10.11.x) show each file as a separate episode.

**ID tags.** [`PathExtensions.GetAttributeValue`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Server.Implementations/Library/PathExtensions.cs#L20) accepts `[]`, `()` or `{}`, `-` or `=`, and both `tmdbid`/`tmdb`, `tvdbid`/`tvdb` and `imdbid`/`imdb`. Plex's `{tmdb-…}` and `{tvdb-…}` therefore work, and the [identifiers doc](https://github.com/jellyfin/jellyfin.org/blob/ef4a07689f8e3672d8b1e841da979c44bbe97e62/docs/general/server/metadata/identifiers.md) shows `{tmdb-680}` as an example. Movies read TMDB and TVDB IDs from the folder name, then the file name; IMDb IDs come from anywhere in the path ([`MovieResolver.SetProviderIdsFromPath`](https://github.com/jellyfin/jellyfin/blob/6f1053ad5f00cb5827a1a981226547e07bad589a/Emby.Server.Implementations/Library/Resolvers/Movies/MovieResolver.cs#L372)). Series read IDs from the show folder. TRaSH warns that "Jellyfin doesn't support IMDb IDs for shows", so use TVDB for Series.

## Silo

Silo's manual says it "reads most names produced by Sonarr, Radarr, FileBot, Plex, and Jellyfin" and recommends one folder per Movie "especially when you have … several versions" ([media-folders.md](https://github.com/Silo-Server/siloserver.org/blob/3dc3670cacc48cc229f27268c054f959c8d246fb/src/content/docs/docs/running-a-server/media-folders.md)). The manual doesn't spell out a versions rule; the source does.

**Movie versions.** The scanner puts every file into a content group, and all files in one group are Versions of one item ([`InferGroupIdentity`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/naming/group_identity.go)):

- An explicit provider tag sets the group key: "files tagged with the same provider ID always share a group and files tagged apart never merge, regardless of how their titles compare". This works across folders too. `Blade Runner (1982) {tmdb-78}` and `Blade Runner (1982) Final Cut {tmdb-78}` in another library folder form one group ([`TestInferGroupAssignments_SameTagAcrossFoldersStillGroups`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/scanner/group_inference_test.go#L369)).
- Untagged files fall back to a normalised title plus year. For example, `Heat (1995) 1080p.mkv` and `Heat (1995) 2160p.mkv` group under `v1|movie|heat|1995` ([test](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/scanner/group_inference_test.go#L393)).
- There is no separator or prefix rule. Resolution, source and codec tokens are stripped from the title.

**Episode versions.** Files link to episodes by season and episode number. Each file is owned by its episode ([`variant_finalize.go`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/scanner/variant_finalize.go#L68)), so two files with the same `S01E01` in one Series are two Versions of that episode. The architecture notes say so in passing: Silo makes sure "a deleted scene numbered `S01E05` never becomes a second version of the real episode" ([media-naming.md](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/docs/architecture/media-naming.md#L70)).

**Editions are inside the item.** `{edition-…}` tags in a folder or file name ([`variants.go`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/naming/variants.go)) become an edition key on the file, and the item stays one item. Silo also guesses an edition from words such as `Extended`, `Theatrical`, `Director's Cut`, `Unrated`, `Uncut`, `Uncensored`, `IMAX`, `Remastered` and `Open Matte`. Quality and language words (`German`, `Dual`, `Multi`, `Remux`, `2160p`, `Hybrid`, …) are removed before that guess. The apps then show **Version** to pick the file and **Edition** to pick the cut ([watch-movies-and-series.md](https://github.com/Silo-Server/siloserver.org/blob/3dc3670cacc48cc229f27268c054f959c8d246fb/src/content/docs/docs/using-silo/watch-movies-and-series.md)). One side effect: a TRaSH custom format name that appears in a file name, such as `Uncensored`, gives that file an Edition in Silo.

**Version labels.** Silo's web app labels a version from the probed media (resolution, video codec, HDR range, audio codec), sorted by resolution ([`VersionFlyout.tsx`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/web/src/pages/ItemDetail/components/VersionFlyout.tsx#L17)). Its Jellyfin-compatible API names each `MediaSource` after the whole file stem ([`mediaSourceName`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/jellycompat/mapping.go#L933)). In Jellyfin apps connected to Silo, the label is the full file name.

**ID tags.** [`folderid.go`](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/internal/naming/folderid.go) reads `tmdb`/`tmdbid`, `imdb`/`imdbid` and `tvdb`/`tvdbid` in `()`, `[]` or `{}` with `-` or `=`. It also reads a bracketed bare `[tt…]` and a folder name ending in `tt…`, but never a bare number. A Movie may carry the ID in its folder or its file name. A Series needs it in the show folder ([manual](https://github.com/Silo-Server/siloserver.org/blob/3dc3670cacc48cc229f27268c054f959c8d246fb/src/content/docs/docs/running-a-server/media-folders.md#provider-ids)). In a mixed library, a TMDB or IMDb tag on a folder counts as Movie evidence and a TVDB-only tag does not ([media-naming.md](https://github.com/Silo-Server/silo-server/blob/5d1ab2ba96c220f9218279d5b880f3afafa5861c/docs/architecture/media-naming.md)). That is another reason to tag Series with `{tvdb-…}`.

## TRaSH recommendations

From [`radarr-naming.json`](https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/docs/json/radarr/naming/radarr-naming.json) and [`sonarr-naming.json`](https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/docs/json/sonarr/naming/sonarr-naming.json):

| | Plex | Jellyfin |
| --- | --- | --- |
| Movie folder | `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}` (or `{imdb-…}`) | `{Movie CleanTitle} ({Release Year}) [tmdbid-{TmdbId}]` (or `[imdbid-…]`) |
| Movie file | `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}` | the same with `[tmdbid-{TmdbId}]` and `{{Edition Tags}}` (no `edition-`) |
| Series folder | `{Series CleanTitleWithoutYear} {(Series Year)} {tvdb-{TvdbId}}` (or `{imdb-…}`) | `{Series CleanTitleWithoutYear} {(Series Year)} [tvdbid-{TvdbId}]` |
| Episode file | `{Series CleanTitleWithoutYear} {(Series Year)} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}` | same |

TRaSH's Plex page also has an "edition alternative" (`{{Edition Tags}}` instead of `{edition-…}`) for people who keep several copies of a Movie and want it to show up once.

TRaSH has no single-folder multi-version scheme. Its HD + UHD setup uses two Radarr or Sonarr instances with separate root folders ("You can not use the same root (media library) folder for both", [Sync-2-radarr-sonarr.md](https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/docs/Radarr/Tips/Sync-2-radarr-sonarr.md)). With separate roots Jellyfin cannot group the copies, because its movie grouping works inside one folder. Kestrel's shared Title folder is what makes Jellyfin grouping possible. The TRaSH file formats above already pass Jellyfin's prefix and separator rules because they use ` - `. The candidate scheme keeps that and adds a Version label.

## Where the servers disagree

| | Plex | Jellyfin | Silo |
| --- | --- | --- | --- |
| What groups Movie versions | Same movie folder, `Title (Year) - text` | Same folder; every file starts with the folder name, then `-`/`_`/`.`/`[..]`; same year; all or nothing | Same provider tag (across folders), else same title + year |
| Episode versions | Yes, same `sXXeYY` | Only from 12.0, same season folder, same `SxxEyy` | Yes, same episode number |
| `{edition-…}` | Separate library item | Just part of the label | Edition picker in the same item |
| Label shown | Probed resolution; filename text hidden | Differing file-name suffix | Web: probed media summary; Jellyfin API: whole file stem |
| Default Version | Most suitable for the app | Exact folder-name file, else highest resolution | Per-profile `playback.preferred_quality` setting |
| Movie ID tags | `{tmdb-}`, `{imdb-}` only, curly braces | Any bracket, `-`/`=`, `tmdb(id)`/`tvdb(id)`/`imdb(id)` | Same as Jellyfin plus bare `tt…` |
| Series ID tags | `{tmdb-}`, `{tvdb-}`, `{imdb-}` in show folder | Any bracket in show folder; TRaSH: no IMDb | Any bracket, show folder only |

The common subset is Plex's syntax: `{tmdb-N}` for Movies and `{tvdb-N}` for Series. Jellyfin and Silo read it, and Plex reads nothing else.

## Candidate scheme for Kestrel

```text
Movie folder:   {Title} ({Year}) {tmdb-{TmdbId}}
Movie file:     {Title} ({Year}) {tmdb-{TmdbId}} - [{VersionLabel}][{Quality Full}][{Language}][{Audio}][{HDR}][{Video codec}]-{Group}.{ext}
Series folder:  {Title} ({Year}) {tvdb-{TvdbId}}
Season folder:  Season {season:00}
Episode file:   {Title} ({Year}) - S{season:00}E{episode:00} - {Episode Title} - [{VersionLabel}][{Quality Full}][{Language}][{Audio}][{HDR}][{Video codec}]-{Group}.{ext}
```

- `{VersionLabel}` is the Profile name (`HD`, `UHD`). It does three jobs. It keeps file names unique when two Versions could get the same quality string. It gives Adoption a direct way to map a file to its Version. And it is the readable start of Jellyfin's label. Plex ignores it, and Silo labels from probed media.
- `{Language}` is a plain bracket such as `[German DL]` for a Dual-Language Release, or Radarr's `{MediaInfo AudioLanguages}` style (`[DE+EN]`). None of the three servers reads language from the file name, and Silo drops `German`/`Dual`/`Multi` before guessing an edition.
- Never write `{edition-…}` into a Version's name. If a release is a different cut, plain text such as `Extended` shows up as an Edition in Silo and is ignored by Plex. Whether Kestrel names editions at all is out of scope here.
- The Movie file name must start with the exact folder name. When Kestrel renames a Title folder, for example after correcting its ID, it must rename every Version's file in the same step, or Jellyfin splits them.
- A ` - ` separator before the Version label is required for Jellyfin Movies. For episodes it puts the label at the start of Jellyfin's computed label, and Plex's TV agent ignores text in brackets.
- Expect UHD to sort first, and be the default selection, in Jellyfin. If HD has to be Jellyfin's default, the HD file would have to be named exactly like the folder, which drops its label. That's not recommended, because it breaks the label's other jobs.

Known gaps: Plex's cross-folder merging and its exact handling of `{tmdb-}` before ` - text` in the file name are not documented beyond the examples cited. The candidate has not been tested on a live Plex, Jellyfin or Silo server; that would be a worthwhile check before the naming ADR is final.
