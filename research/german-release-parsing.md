# Research: German release-name parsing and audio verification

Ticket: [#7](https://github.com/hyprsh/kestrel/issues/7). Researched 2026-10-17. Related: [#2](https://github.com/hyprsh/kestrel/issues/2), whose findings are in [`research/trash-german-profiles.md`](https://github.com/hyprsh/kestrel/blob/research/trash-german-profiles/research/trash-german-profiles.md).

## Question

What are the German scene release naming conventions (German, German DL, ML, mic-dubbed and line-dubbed tags such as MD, LD and AC3D, DUBBED, Synced, group conventions)? How do Radarr and Sonarr parse language and quality out of release names? Which Go release-name parser libraries exist, and how well do they handle German releases? How reliably can a file's audio languages be checked at Import (ffprobe or mediainfo), and how often are audio language tags missing or wrong?

## Short answer

1. **"DL" means German plus the original-language audio (O-Ton). It does not always mean German plus English.** The German retail movie ruleset requires a German dub release to carry the original dialogue track as well, tagged `DL`. Radarr and Sonarr turn `German … DL` into `{German, Original}` and then resolve `Original` to the Title's original language from metadata. `ML` becomes `{German, Original, English}`. For an English-language Title, a Dual-Language Release is German + English. For a Japanese anime it is German + Japanese, and for a German-original film `DL` adds nothing. `GLOSSARY.md` currently defines Dual-Language Release as "German and English", which only holds for English-original Titles (see section 6).
2. **The release-name grammar is small and well-defined**: `Title.<YEAR>.<TAGS>.GERMAN.[DL].<RES>.<SOURCE>.<CODEC>-GROUP`. Release names use the *German* title. German BluRay remuxes often omit `REMUX` and are recognised by a video-codec name (AVC/HEVC/VC-1) together with `BluRay`. German WEB releases use provider-HD source tags (`AmazonHD`, `NetflixHD`, `DisneyHD`, `HBOMaxHD`, `MaxdomeHD`).
3. **No Go library parses German language semantics the way TRaSH custom formats expect.** `autobrr/rls` (MIT) is the best of them: it emits a `DL` token but misses `ML`, `Ger`, `SwissGerman` and the provider-HD sources. The PTT ports (`go-ptt`, `jhin`) drop `DL` entirely. Radarr and Sonarr are GPL-3.0, like Kestrel, so **porting their `LanguageParser`/`QualityParser` regexes and test fixtures to Go is legal and gives the closest fidelity to TRaSH**. This is the recommendation.
4. **Audio verification at Import is cheap and usually right for German releases, but it is not ground truth.** German scene rules require correct ISO 639 codes, German as the default and first audio track, and `und` for unknown languages. Radarr and Sonarr already run ffprobe at Import, and if any audio track has a recognisable language tag it **overrides** the language parsed from the name. Failure modes: tracks with no Language element read as **`eng`** in ffprobe (the Matroska default); `und` tracks are ignored; P2P and WEB groups follow no ruleset. No published measurement of how often tags are missing or wrong was found.

## Sources

Pinned to the commits read:

| Source | Commit |
|---|---|
| [Radarr/Radarr](https://github.com/Radarr/Radarr) (`develop`, GPL-3.0) | `df2faa64c75e6081556d11232dc46523e7264ea1` |
| [Sonarr/Sonarr](https://github.com/Sonarr/Sonarr) (`develop`, GPL-3.0) | `2b39049ee6e16e1b326792009ea4b985e29adf48` |
| [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides) (`master`, MIT) | `14a4166673996301e588a4f70d03b9cfb760b50f` |
| [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) (`master`) | `e9b3c55fe0321915a70f44f30b276ef2afdc3a0c` |
| [ietf-wg-cellar/matroska-specification](https://github.com/ietf-wg-cellar/matroska-specification) | `1a943ead9bb4c67b02b966cebafe51c8c074e703` |
| [autobrr/rls](https://github.com/autobrr/rls) v0.9.0 (MIT) | `90d0fdacbbe78c77af974591d5ffb67aba08d643` |
| German scene rulesets on [scenerules.org](https://scenerules.org/) | fetched 2026-10-17 |
| [mkvmerge documentation](https://mkvtoolnix.download/doc/mkvmerge.html) | fetched 2026-10-17 |

Shorthand: `RR:` = `https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/`, `SR:` = `https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/`, `TG:` = `https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/`, `FF:` = `https://github.com/FFmpeg/FFmpeg/blob/e9b3c55fe0321915a70f44f30b276ef2afdc3a0c/`.

## 1. German release naming conventions

### 1.1 Rulesets (primary)

The German scene publishes its own rulesets. The ones that bear on naming and audio:

- **German Retail Movie Rules rev. 1** ([`german.retail.movie.rules.rev.1`](https://scenerules.org/html/german.retail.movie.rules.rev.1.html), listed as the 2026 MOVIES ruleset, 20 signing groups including ENCOUNTERS, PL3X, SAViOURHD, SPiCY, UNDERTAKERS and WATCHABLE). It declares itself the only official ruleset for HD, UHD and SD movies (rule 23.1).
- **German Retail TV Series Rules v1.0** ([`2020_DE_GRTVSR`](https://scenerules.org/html/2020_DE_GRTVSR.html), effective 2020-01-03, signed by ATAX, AWARDS, DOKUMANiA, EXCiTED, iNTENTiON, LizardSquad, RSG, RWP, STARS, TVARCHiV and UHDTV).
- **German x264 v3** ([`2011_DE_X264`](https://scenerules.org/html/2011_DE_X264.html), binding from 2011-08-10, signed by DETAiLS, ENCOUNTERS, GOREHOUNDS, MiSFiTS, RSG, WOMBAT and others). It was superseded for movies but still shows the long-standing audio track order.

Directory formats:

- Movies (retail rule 18.4.1): `Filmtitel.<JAHR>.<TAGS>.GERMAN.[DL].<AUFLÖSUNG>.<FORMAT>.<x264|x265>-GROUP`.
- TV (GRTVSR G4): title, `SxxEyy`, optional episode title, language with optional `.SUBBED`, optional audio format (`AC3`/`DTS`), `FS` only for 4:3, resolution, source, codec, group. Examples: `The.Shield.S01E01.German.DL.720p.BluRay.x264-GROUP` and `The.Shield.S01E01.German.BDRip.x264-GROUP`.
- **The title is the German title.** x264 v3 rule 1.6 requires it, using IMDb "also known as" as the reference. Kestrel's release-to-Title matching therefore needs German alternative titles (from TMDB/TVDB translations), not only the English or original title.
- Case is not significant (GRTVSR G4: all-lower or all-upper tagging is not an error). Tag order within `<TAGS>` is up to the group (retail rule 17.6).

### 1.2 Tag glossary

| Tag | Meaning | Authority |
|---|---|---|
| `GERMAN` | German audio is present. Without `DL`/`ML` it means German only. | Retail 18.4.1; TRaSH `German` CF (`TG:docs/json/radarr/cf/german.json`) |
| `DL` | Dual language: the German dub **plus the original-language (O-Ton) dialogue track**. Mandatory on German dub releases, except when the film is German-language. | Retail 8.6: "neben der deutschen Synchronisation auch die O-Ton Dialogspur enthalten … mit dem DL-Tag versehen". GRTVSR G4: `DL` whenever the release has two audio tracks. |
| `ML` | Multi-language: German, the original language and further tracks (in practice usually English as well, e.g. for anime). | Not in the rulesets read. Defined by Radarr/Sonarr behaviour (`GermanMultiLanguageRegex` adds Original + English) and TRaSH `German DL (undefined)` |
| `DUBBED` | A German audio track was added that is **not on the original disc** (taken from another source and synced). Usually combined: `German.Dubbed.DL`. | Retail 8.8 |
| `AC3D`, `EAC3D`, `DTSD` | Codec plus "D(ubbed)": the German track is a dub sourced elsewhere, in that codec. | **Low confidence.** No ruleset defines them. Usage is attested only by Radarr test fixtures (`Movie.Name.2024.German.AC3D.DL…`, `…German.EAC3D.DL…`) and by community explanations ("AC3.Dubbed"). rls labels `DTSD` "DTS (dual language)". |
| `LD` / `LINE` / `LINE.DUBBED`, `AC3LD` | Line-dubbed: audio taken from the cinema's line feed. A non-retail source. | Retail 2.4 and 2.4.1 (LD and MD are non-retail tags, may be pred at most 4 weeks before retail, otherwise nuked CTR). TRaSH `Line/Mic Dubbed` CF regex `\b(LD|AC3LD|Line[ .-]?Dubbed)\b` |
| `MD` / `MIC.DUBBED`, `AC3MD` | Mic-dubbed: audio recorded with a microphone in the cinema. The lowest audio quality. | Same; TRaSH regex `\b(MD|AC3MD|Mic[ .-]?Dubbed)\b`, description in `TG:includes/cf-descriptions/line-mic-dubbed.md` |
| `SUBBED` | Non-German-language release with German subtitles, flagged default + forced, or hardcoded across the whole film. | Retail 8.7, 10.5.1, 10.6; GRTVSR G4 |
| `OmU` | "Original mit Untertiteln": original audio with German subs. | TRaSH `German Subbed` CF regex `…(?:Sub(?:bed|s)?|OmU)` |
| `Synced` | Seen in WEB releases (`German.DD51.Synced.DL…-TVS`, a Sonarr fixture). The German track was re-timed onto the video from another source. | **Low confidence**: usage only. No ruleset defines it. |
| `Ger`, `GER`, `DE`, `SwissGerman` | P2P and international multi-audio naming (`Eng.Fre.Ger.Ita…`, `HU-IT-DE`). | Radarr fixtures; Radarr issue [#10823](https://github.com/Radarr/Radarr/issues/10823) and PR [#10819](https://github.com/Radarr/Radarr/pull/10819) added `\bger\b` and case-sensitive `DE` |
| `PD` | Pirate Dub (2004-era naming `<Titel>.<QUELLE>.PD.German.<FORMAT>-GRP`). Historic. | [`2004_DE_PD`](https://scenerules.org/html/2004_DE_PD.html) rule 10 |

Source and quality conventions that differ from the English scene:

- **German remuxes without a `REMUX` tag.** `This.Wonderful.Movie.1991.German.ML.1080p.BluRay.AVC-GeRMaNSCeNEGRoUP` is a Remux-1080p in Radarr's fixtures, recognised because a video-codec name (AVC, HEVC, VC-1, MVC, MPEG-2) appears where an encode would carry `x264`/`x265`. Radarr has a dedicated `GermanRemuxRegex` (`RR:NzbDrone.Core/Parser/QualityParser.cs` line 77), and its `BRDISKRegex` excludes `German.*[DM]L` names so these are not taken for full discs. Sonarr has no equivalent.
- **Provider-HD WEB source tags**: `AmazonHD`, `AmazonSD`, `NetflixHD`/`NetflixUHD`, `DisneyHD`, `HBOMaxHD`, `MaxdomeHD`, `iTunesHD` all mean WEB-DL in both apps' `SourceRegex` (`RR:…/QualityParser.cs` line 19; `SR:…/QualityParser.cs` line 19). Sonarr issue [#5507](https://github.com/Sonarr/Sonarr/issues/5507) fixed `DisneyHD` being read as HDTV.
- **`WEB.DL` collides with `DL`.** `GERMAN.1080P.WEB.DL` is German only. Both apps guard against it with `(?<!WEB[-_. ]?)\bDL\b`, and Radarr has tests for `WEB-DL`, `WEB.DL`, `WEB DL` and `WEBDL` (`RR:NzbDrone.Core.Test/ParserTests/LanguageParserFixture.cs` lines 560–569).
- **UHD BluRay variants**: `UHDBD`, `UHD2BD`, `UHDBDRip` (Radarr fixtures, lines 294–320 of `QualityParserFixture.cs`).

### 1.3 Audio track conventions inside the file (scene rules)

This determines how far audio probing can be trusted (section 4):

- **German audio is the first track and the default.** x264 v3 rules 2.9 and 2.10 (German = default, O-Ton = not default; track 1 = ger, track 2 = O-Ton). Retail 8.14 (German track default, English non-default). GRTVSR B05 (German audio default, second audio not default, German forced subs default + forced). TRaSH also cites this as a scene "best practice" (`TG:includes/german-guide/radarr-german-advanced-audio-information-en.md`).
- **Every audio track must carry the correct ISO 639 code supported by MKVToolNix, and `und` when the language is not supported** (retail 8.13 and 8.13.1). Subtitles likewise (retail 11.2.1).
- The container is Matroska, and MKVToolNix is the recommended muxer (retail 12.1).
- Each language appears only once, in the best quality allowed for the resolution (retail 8.10). The German track may be lower quality than the original: TRaSH warns that the audio format in the name may describe the original track, not the German one, and that Radarr's post-Import audio CFs score only the first (default) track, which is the German one.

### 1.4 Group conventions

TRaSH tracks German groups as release-group CFs: German Scene, German Web/Bluray/Remux Tier 01–03, German LQ, German Microsized (`TG:docs/json/radarr/cf/german-*.json`). Scoring is covered in [#2](https://github.com/hyprsh/kestrel/issues/2). Points relevant to parsing:

- The `German LQ (release title)` CF flags a **double German tag** `[._-]German[._-].+?[._-]?German$` and names ending `Jellyfin-Plex`. Kestrel's parser must keep the full title available for regex CFs and not only parsed fields.
- Group matching is mostly `^(GROUP)$` against the parsed release group, so **release-group extraction must match Radarr's `ReleaseGroupParser`**, or tier CFs silently stop matching.

## 2. How Radarr and Sonarr parse language and quality

### 2.1 Language from the release name

`LanguageParser.ParseLanguages` (`RR:NzbDrone.Core/Parser/LanguageParser.cs`; `SR:NzbDrone.Core/Parser/LanguageParser.cs`) works in three passes:

1. Plain `Contains` checks for full English language names ("spanish", "japanese", and so on; Radarr also checks "english").
2. A case-sensitive regex for two-letter codes (`\bDE\b`, `\bEN\b`, `\bPL\b`, …) that are not adjacent to `SUB`.
3. A case-insensitive regex. German is `(?<german>(?:swiss)?german\b|videomann|ger[. ]dub|\bger\b)`. `Videomann` is a German uploader name kept for historic reasons.

Then the German-specific step (identical in both apps, Radarr lines 458–471, Sonarr 211–222):

```csharp
GermanDualLanguageRegex  = (?<!WEB[-_. ]?)\bDL\b   // IgnoreCase
GermanMultiLanguageRegex = \bML\b                  // IgnoreCase

if (languages.Count == 1 && languages.Single() == Language.German)
{
    if (GermanDualLanguageRegex.IsMatch(title))      languages.Add(Language.Original);
    else if (GermanMultiLanguageRegex.IsMatch(title)) { languages.Add(Language.Original); languages.Add(Language.English); }
}
```

`DL`/`ML` apply **only when German is the only language parsed**. `Eng.Ger.DL` is therefore not upgraded, because it already has two languages.

What happens next:

- **Title words are removed first.** Radarr replaces the parsed movie title with `A Movie`, and the release group with `RlsGrp`, before calling the language parser (`RR:NzbDrone.Core/Parser/Parser.cs` lines 255–279). It later subtracts languages that come from the Title's own name (`RR:NzbDrone.Core/Download/Aggregation/Aggregators/AggregateLanguages.cs`). Sonarr strips everything before `SxxEyy` (`CleanSeriesTitleRegex`) and makes the main regex skip languages followed by `sub(s)` (Sonarr issue [#8322](https://github.com/Sonarr/Sonarr/issues/8322)). This keeps "The German Doctor" from reading as German (Radarr issue [#6474](https://github.com/Radarr/Radarr/issues/6474)).
- **`Original` is resolved against metadata** in `AggregateLanguages` (both apps): it is replaced by the Movie's or Series' `OriginalLanguage`. If that language is already in the list, for example German for a German film, `Unknown` is added instead. This is why TRaSH warns that German-original films "will be identified as `German DL` even though they might not contain another language" (`TG:docs/Radarr/radarr-setup-quality-profiles-german-en.md`).
- **Indexer-supplied languages win over parsing.** If an indexer sets `MultiLanguages` and the title contains `MULTi`, those languages are added.
- **Fallback:** if nothing parses, both apps assume the Title's original language. An untagged release of an English film is therefore "English".

TRaSH's German CFs are built on these semantics (`TG:docs/json/radarr/cf/german-dl.json`, `german.json`, `german-dl-undefined.json`):

- `German DL` = language German **and** language `Original` (value `-2`, i.e. the Title's original language).
- `German` = German, NOT Original, no `DL`/`ML` in the title, not subbed.
- `German DL (undefined)` = German, NOT Original, but `DL` or `ML` in the title.

A faithful Kestrel must reproduce the parsed language *set*, including `Original` resolution, not just a "dual" flag.

### 2.2 Quality from the release name

`QualityParser.ParseQuality` combines a `SourceRegex` (named groups `bluray`, `webdl`, `webrip`, `hdtv`, `dvd`, …), a resolution regex, `RemuxRegex` together with Radarr's `GermanRemuxRegex`, `BRDISKRegex`, and proper/repack/version detection. The German-specific parts are listed in section 1.2. The test fixtures are the best available corpus of real-world German names: `RR:NzbDrone.Core.Test/ParserTests/QualityParserFixture.cs`, `LanguageParserFixture.cs` and the Sonarr equivalents contain more than 50 German release names with expected results.

### 2.3 Language at Import

Both apps aggregate the languages of a local file from four augmenters, in order: file name (1), folder name (2), download-client item (3), **MediaInfo (4)**. The **last non-empty, non-Unknown result wins**. So if ffprobe finds any audio track whose language tag maps to a known language, those audio languages **replace** what was parsed from the name (`RR:NzbDrone.Core/MediaFiles/MovieImport/Aggregation/Aggregators/AggregateLanguage.cs`, `…/Augmenters/Language/AugmentLanguageFromMediaInfo.cs`; Sonarr: `SR:NzbDrone.Core/MediaFiles/EpisodeImport/Aggregation/…`).

- The MediaInfo augmenter maps each track tag through `IsoLanguages.Find`, which takes 2-letter codes, 3-letter T/B codes (`ger`→`deu`) and `xx-YY` forms. Unmappable tags (`und`, empty) are dropped. If none remain, it abstains.
- `MediaInfoModel.AudioLanguages` comes from ffprobe stream tags (`RR:NzbDrone.Core/MediaFiles/MediaInfo/VideoFileInfoReader.cs` lines 60–91). Radarr bundles ffprobe and probes with `-probesize 50000000`, retrying with `150000000` and `-analyzeduration`.

This is what TRaSH's `German DL (undefined)` relies on: a file named German-only whose probe shows `ger, eng` is re-classified after Import.

## 3. Go release-name parser libraries

### 3.1 Candidates

| Library | License | Activity | Notes |
|---|---|---|---|
| [autobrr/rls](https://github.com/autobrr/rls) (fork of [moistari/rls](https://github.com/moistari/rls), used by autobrr) | MIT | active (pushed 2026-10-17), v0.9.0 | Lexer plus CSV taxonomy (`taginfo/taginfo.csv`). Has `DL`, `DUBBED`, `SYNCED`, `SUBBED`, `MULTi`, `AC3D`, `EAC3D`, `MD`, `LD` tags. **No `ML`.** `GER` is a *region*. No provider-HD sources. |
| [MunifTanjim/go-ptt](https://github.com/MunifTanjim/go-ptt) | MIT | v0.14.1, 2026-02 | Port of PTT (parse-torrent-title). Torrent and anime oriented. Languages as ISO codes, `Dubbed`/`Subbed` booleans. |
| [dreulavelle/jhin](https://github.com/dreulavelle/jhin) | MIT | v0.8.0, very new (2 stars) | "Go successor to PTT" with a ranker. A `DualAudio` field, but it is not set by `DL`. |
| [cehbz/torrentname](https://github.com/cehbz/torrentname) | MIT | v1.2.1 | Single `Language` string. Weak on scene names. |
| [middelink/go-parse-torrent-name](https://github.com/middelink/go-parse-torrent-name) | MIT | unmaintained since 2019 | Port of Python PTN. No German support. |
| [ProfChaos/torrent-name-parser](https://github.com/ProfChaos/torrent-name-parser) | **no license** | — | Not usable. |

Prior art in Go apps that contain German DL handling (found by code search for "German DL"): [tristenlammi/Arrmada](https://github.com/tristenlammi/Arrmada) (MIT, `internal/parser/`), [kyleaupton/arrflix](https://github.com/kyleaupton/arrflix) (GPL-3.0, `backend/internal/parsing/language.go`), and [bwees/magpie](https://github.com/bwees/magpie) (no license). These were not evaluated in depth.

### 3.2 Empirical test on German names

The harness ran 30 names, most taken from the Radarr/Sonarr fixtures, through each library (Go 1.27.2, versions above). Summary of what Kestrel needs, where ✓ = correct and ✗ = wrong or lost:

| Case (expected) | rls | go-ptt / jhin | torrentname | ptn |
|---|---|---|---|---|
| `German.DTS.DL…BluRay` (DL) | ✓ `[GERMAN DL]` | ✗ `[de]`, DL lost | ✗ language empty | ✗ |
| `German.ML.1080p.BluRay.AVC` (ML) | ✗ `[GERMAN]` | ✗ `[de]` | ✗ | ✗ |
| `GERMAN.1080P.WEB.DL` (German only) | ✓ `[GERMAN]`, src WEB-DL | ✓ `[de]` | ✓ | ✗ |
| `Ger.Dub.AAC…` (German) | ✗ `[]` | ✓ `[de]` dubbed | ✗ | ✗ |
| `SwissGerman.WEB-DL` (German) | ✗ | ✗ | ✗ | ✗ |
| `German.Dubbed.DL`, `German.AC3D.DL`, `Synced.DL` (DL) | ✓ (`DUBBED`, `AC3D`, `SYNCED` kept) | ✗ DL lost | ✗/partial | ✗ |
| `German.MD.TS` / `German.LD.DL` | ✓ `MD`/`LD` in Other | ✗ not flagged | ✗ | ✗ |
| `AC3LD` | ✗ not flagged | ✗ | ✗ | ✗ |
| `German.Subbed` / `OmU` (subs only) | ✓ `SUBBED` | ✓ subbed | partial | ✗ |
| `The.German.Doctor.2013…` (not German) | ✓ | ✓ | ✓ | ✓ |
| Source of `AmazonHD`/`NetflixHD`/`DisneyHD`/`HBOMaxHD` | ✗ empty | ✗ empty | ✗ | ✗ |
| Source of `UHD2BD` | ✗ empty | ✗ empty | ✗ | ✗ |
| Remux of `German.ML.1080p.BluRay.AVC` | ✗ BluRay only | ✗ | ✗ | ✗ |
| Title/year/group/resolution | ✓ throughout | ✓ throughout | title often polluted (`Movie Title 2016 German DTS DL`) | mostly ✓ |

### 3.3 Fit

- **None reproduces Radarr's language set** (German + Original, German + Original + English), Radarr's Remux and WEB-DL source mapping for German names, or Radarr's release-group extraction. TRaSH CFs are written against exactly those parsed fields (`LanguageSpecification`, `SourceSpecification`, `QualityModifierSpecification`, `ReleaseGroupSpecification`). Any mismatch silently changes scores.
- **Recommended: port Radarr's and Sonarr's parser to Go**, covering at least `Parser` title/year/episode extraction, `LanguageParser`, `QualityParser`, `ReleaseGroupParser` and the `AggregateLanguages` `Original` resolution, together with their NUnit fixtures as table-driven Go tests. Both projects are **GPL-3.0, and Kestrel is GPL-3.0**, so a derived port is license-compatible, provided attribution and copyright notices are kept. Go's `regexp` (RE2) lacks lookbehind and lookahead, which these regexes use heavily (`(?<!WEB[-_. ]?)\bDL\b`, `(?=.*Blu-?ray)`). The port needs either [`dlclark/regexp2`](https://github.com/dlclark/regexp2) (MIT, a .NET-compatible regex engine for Go) or a rewrite of each lookaround as code. TRaSH CF `ReleaseTitleSpecification` regexes are .NET regexes with lookarounds too, so Kestrel's CF engine needs `regexp2` regardless (cross-check with #2).
- `autobrr/rls` is a reasonable *secondary* tokenizer if a port is judged too large. It still needs a German language layer on top (ML, Ger/DE, WEB.DL guard, Original resolution) and a source layer (provider-HD, German remux).

## 4. Audio verification at Import

### 4.1 What the tools report

- **ffprobe**: `ffprobe -v error -select_streams a -show_entries stream=index,codec_name,channels:stream_tags=language,title:stream_disposition=default,original,dub,comment -of json FILE`. For Matroska, FFmpeg's demuxer sets the `language` tag from the track's `Language` element (`FF:libavformat/matroskadec.c` line 618 sets **the default to `"eng"`**), and **omits the tag when the value is `und`** (lines 3296–3297). Dispositions map from Matroska flags: `default`, `forced`, `comment`, `hearing_impaired`, `visual_impaired`, and `original` versus `dub` from `FlagOriginal` (lines 3277–3288). FFmpeg does not read `LanguageBCP47` (no reference in `matroskadec.c`).
- **Matroska spec**: `Language` has `default="eng"`. `LanguageBCP47` (v4), when present, overrides `Language`, which "MUST be ignored". `FlagDefault` defaults to 1. `FlagOriginal` marks the content's original language (`ebml_matroska.xml`, elements `Language`, `LanguageBCP47`, `FlagDefault`, `FlagOriginal`).
- **mkvmerge** (MKVToolNix): tracks whose source has no language get `--default-language`, which **defaults to `und`**. It always writes the IETF/BCP47 element and derives the legacy `Language` element from it, unless `--disable-language-ietf` is given ([mkvmerge docs](https://mkvtoolnix.download/doc/mkvmerge.html)).
- **MP4**: FFmpeg reads the `mdhd` language. Packed ISO codes pass through (including `und`). The old Apple numeric code 0 maps to `eng` (`FF:libavformat/isom.c`, `ff_mov_lang_to_iso639` and `mov_mdhd_language_map`).
- **mediainfo** (BSD-2-Clause) reports per-track `Language` too. Radarr and Sonarr both probe with ffprobe (through FFMpegCore's `FFProbe.Analyse`, same arguments in Sonarr's `VideoFileInfoReader.cs` lines 61–66). For Kestrel either tool works, and ffprobe is the one the *arrs exercise.

### 4.2 Reliability

What the sources support:

- **German scene releases (the main target) are reliable by rule.** Every audio track must carry the correct ISO 639 code, `und` if unsupported, and German is the default (and, per x264 v3, the first) audio track (section 1.3). Scene releases that break this are nukeable.
- **A missing `Language` element reads as English.** By the Matroska spec default, and in ffprobe, an untagged track is `eng`. A German-only file muxed by a tool that omits the element would look like "English" to Kestrel. mkvmerge writes `und` instead, which ffprobe hides, so Radarr then falls back to the name.
- **`und` is invisible.** Radarr and Sonarr skip it and fall back to name parsing. Kestrel should do the same, and treat "N audio tracks, M tagged" as a confidence signal.
- **P2P and WEB-DL groups follow no ruleset.** Their tags come from the streaming manifest or the ripper's tool. TRaSH's existence of `German DL (undefined)` and its example name `… [7.1, 7.1] [ger, eng] …` show mislabelled names happen in practice. Probe tags are the corrective signal there, not the problem.
- **Wrong tags (as opposed to missing ones)** are a known failure mode of manual muxing, for example a German dub tagged `eng` because it was copied from an English source. No source quantifies how common this is.
- **No published measurement** of missing or wrong audio language tags in German usenet releases was found in Radarr/Sonarr issues, TRaSH, or the rulesets. Treat the rate as unknown. If it matters, measure it on the household's own library during Adoption with a one-off ffprobe sweep.

Audio-content language identification (speech LID on a few seconds of each track) is the only way to get ground truth. It would add an ML model to a single-binary Go app and is out of proportion for v1.

### 4.3 Practical implications for Import (input for later tickets)

- Probe every completed download. Read audio track count, `language` tags, `default` and `original`/`dub` dispositions, codec and channels per track.
- Use probe languages when **at least one** track maps to a known language. Otherwise keep the name-parsed set (the Radarr rule). Consider a stricter rule for Kestrel: if the name says DL but the probe shows a single tagged track, treat the file as not a Dual-Language Release.
- Treat a lone `eng` with no explicit `Language` element in a `German`-named release as suspect, not authoritative. A pure-Go EBML reader such as [remko/go-mkvparse](https://github.com/remko/go-mkvparse) (MIT) or [at-wat/ebml-go](https://github.com/at-wat/ebml-go) (Apache-2.0) can tell "absent" from "eng" and read `LanguageBCP47`, which ffprobe cannot.
- Score audio-format CFs on the German (first/default) track, as Radarr does.

## 5. Open points not resolved here

- Exact meaning of `AC3D`/`EAC3D`/`DTSD` and `Synced`: attested only by usage, with no ruleset definition. They are parsed as "German dub" variants. Scoring does not depend on them except through TRaSH regexes.
- Whether Kestrel should port Sonarr's or Radarr's variant where they differ. Radarr has `GermanRemuxRegex` and an English full-name check; Sonarr has the series-title strip and the `subs` lookahead. A port should take the union, with both fixture sets.

## 6. Glossary impact

`GLOSSARY.md` defines **Dual-Language Release** as "carrying both German and English audio". The scene and the *arrs define `DL` as **German + original language**. The two match for English-original Titles only. For Japanese, French or other non-English originals, a German DL carries no English. For German originals, `DL` is redundant. The glossary entry should say "German plus the Title's original-language audio" (the TRaSH `German DL` CF semantics), and the "fall back to English" preference should be re-read as "fall back to the original language", unless the household explicitly wants English over the original for non-English Titles.
