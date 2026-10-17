# Research: TRaSH German custom formats and profiles

Ticket: [#2](https://github.com/hyprsh/kestrel/issues/2). Researched 2026-10-17.

## Question

What German custom formats (CFs) and quality profiles does TRaSH Guides publish for Radarr and Sonarr (UHD, HD, German / German DL / English handling, language scoring, Cutoff)? What is the JSON schema of TRaSH's CF and profile data, and how does Recyclarr consume it? Which condition types must Kestrel's scoring engine implement to evaluate those formats faithfully? What license covers the data, and can Kestrel bundle a snapshot?

## Sources

All findings were checked against these sources, pinned to the commits read:

| Source | Commit |
|---|---|
| [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides) (`master`) | `14a4166673996301e588a4f70d03b9cfb760b50f` (2026-10-12) |
| [recyclarr/recyclarr](https://github.com/recyclarr/recyclarr) (`master`) | `604afc909a44e1414567644d7c4fadf22d3be354` (2026-10-15) |
| [Radarr/Radarr](https://github.com/Radarr/Radarr) (`develop`) | `df2faa64c75e6081556d11232dc46523e7264ea1` (2026-10-14) |
| [Sonarr/Sonarr](https://github.com/Sonarr/Sonarr) (`develop`) | `2b39049ee6e16e1b326792009ea4b985e29adf48` (2026-10-16) |

Shorthand used below: `TG:` = `https://github.com/TRaSH-Guides/Guides/blob/14a4166673996301e588a4f70d03b9cfb760b50f/`, `RR:` = `https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/`, `SR:` = `https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/NzbDrone.Core/`, `RC:` = `https://github.com/recyclarr/recyclarr/blob/604afc909a44e1414567644d7c4fadf22d3be354/`.

The human-readable guides are [Radarr German profiles](https://trash-guides.info/Radarr/radarr-setup-quality-profiles-german-en/) and [Sonarr German profiles](https://trash-guides.info/Sonarr/sonarr-setup-quality-profiles-german-en/), whose sources are `TG:docs/Radarr/radarr-setup-quality-profiles-german-en.md` and `TG:docs/Sonarr/sonarr-setup-quality-profiles-german-en.md`.

## 1. German quality profiles

TRaSH publishes six German profiles per app, in `TG:docs/json/{radarr,sonarr}/quality-profiles/german-*.json`. They are grouped under "German" in `TG:docs/json/{radarr,sonarr}/quality-profile-groups/groups.json`.

| Profile | Allowed qualities (one merged group, "Merged QPs") | Radarr trash_id | Sonarr trash_id |
|---|---|---|---|
| [German] HD Bluray + WEB | Bluray/WEBDL/WEBRip 720p+1080p | `2b90e905c99490edc7c7a5787443748b` | `dca7e5e9e99c703bcbdaaa471dd40e98` |
| [German] HD Remux + WEB | Remux-1080p, WEBDL/WEBRip-1080p | `c13c33fdd2c306266b34cb9946de5919` | `0dd5f085ed61a1e01f6d347779dfa1bc` |
| [German] UHD Bluray + WEB | Bluray/WEBDL/WEBRip-2160p | `27cc3d153c0a799fd139ef1ff4c4cc42` | `3b0fa37fddaaefc931b75f2889d4b4f5` |
| [German] UHD Bluray + WEB (Alternative) | 2160p, plus 1080p and 720p as early fallback | `425da1ba30711b55d2eb371437ec98d7` | `7324309a7d1e10dc0dc2cea6c70ed852` |
| [German] Remux + WEB 2160p (Radarr) / [German] UHD Remux + WEB (Sonarr) | Remux-2160p, WEBDL/WEBRip-2160p | `79faa9943cef2f510b997b1f2a9f3ea6` | `08cececf1840290f6fd490b7d79e8642` |
| [German] Anime HD Bluray + WEB | as HD Bluray + WEB, plus anime CFs | `bf3cc2e99ad9a804a9b0d0e538e1fbba` | `6fe5937e1dcc2269e23b49eb46dfe6d6` |

All six share these settings, in both apps:

- `trash_score_set: "german"` (the anime profile uses `german-anime`).
- `upgradeAllowed: true` and `cutoff: "Merged QPs"`. All allowed qualities sit in one merged group, so the quality cutoff is met by any grab, and upgrades are driven only by CF score. The guide says it merges qualities "to allow upgrades based on language without release qualities interfering".
- `minFormatScore: 0`, `minUpgradeFormatScore: 1`, `cutoffFormatScore: 35000`. The guide says 35k is "more than the highest reachable score", so **upgrades never stop on score**. In practice the TRaSH German profiles have no Cutoff in Kestrel's sense.
- Radarr: `language: "Any"`, because "otherwise, English movies identified with German audio and vice-versa will not be grabbed". Sonarr profiles carry `language: "None"`, since Sonarr has no profile language (`RC:docs/architecture/quality-profile-pipeline.md`, "Language Passthrough").
- The guide also asks users to set Propers/Repacks to "Do Not Prefer" and let the Repack/Proper CFs score them instead.

The profile JSON lists only the profile's base CFs (`formatItems`). Unwanted formats, streaming services, HDR, audio and similar sets come from **CF groups**, covered in section 3.

### Language scoring (same in all German profiles, both apps)

| CF | Score in `german` set | Matches when (Radarr/Sonarr semantics) |
|---|---|---|
| German DL | **11000** (default set: -10000) | languages contain German **and** the Title's original language |
| German DL (undefined) | 11000 | German, NOT original language, and title has `DL` or `ML` (used to fix mislabelled files after Import) |
| German | **10000** | German, NOT original language, title has no `DL`/`ML`, not a German-subbed release |
| Not German or English | **-35000** | neither German nor English parsed, and "german" not in the title |
| German 1080p Booster | 650 | German + original language + 1080p |
| German 2160p Booster | 9000 (UHD profiles only) | German + original language + 2160p |
| 2160p / 1080p / 720p | 100 / 50 / 5 | resolution |

Release-group tiers stack on top: German Bluray Tier 01–03 (2900/2650/2300), German Web Tier 01–03 (2100/1900/1800) and German Scene (1700), followed by the English tiers HD/UHD Bluray Tier 01–03 (1800/1750/1700, Radarr) and WEB Tier 01–03 (1700/1650/1600). Repack/Proper/Repack2/Repack3 score 5/6/7.

Sources: `TG:docs/json/radarr/cf/german-dl.json`, `german.json`, `german-dl-undefined.json`, `not-german-or-english.json`, `german-1080p-booster.json`, `german-2160p-booster.json`, and the profile files. The scores were resolved by applying each profile's `trash_score_set` to each CF's `trash_scores`.

**Workflow the guide intends** (`TG:docs/Radarr/radarr-setup-quality-profiles-german-en.md`, "German audio"): grab the English release first if it comes out first, upgrade when a German or German DL release appears, then keep upgrading by CF score. Tip from the guide: set `minFormatScore` to 10000 to get German audio only.

**Worked examples** (my arithmetic from the data; an English-original movie under [German] HD Bluray + WEB):

| Release | Score |
|---|---|
| English 1080p WEB-DL, WEB Tier 01 group | 50 + 1700 = **1750** |
| German-only dub 1080p WEB-DL, German Web Tier 01 group | 10000 + 50 + 2100 = **12150** |
| German DL 720p WEB-DL, German Web Tier 01 group | 11000 + 5 + 2100 = **13105** |
| German DL 1080p WEB-DL, German Web Tier 01 group | 11000 + 650 + 50 + 2100 = **13800** |
| German DL 1080p Bluray, German Bluray Tier 01 group | 11000 + 650 + 50 + 2900 = **14600** |
| Anything matching an unwanted CF (LQ, BR-DISK, German Microsized, …) | -35000, so rejected (below `minFormatScore` 0) |

This gives the order **German DL > German-only > English**. It differs from Kestrel's stated preference ("prefer DL, fall back to English, upgrade to DL"). Under TRaSH, an English file is also upgraded to a German-only dub, and a German-only file is later upgraded to DL. If the household wants English kept over a German-only dub, Kestrel needs a score override on its Profile; plain TRaSH data cannot express that preference.

**Known caveat** (stated in the guide): when German is the Title's *original* language, every German release is identified as German DL. The cause is that "German" and "Original" resolve to the same language (see section 4, language semantics).

### Which CF groups apply to German HD / UHD

Each CF group lists the profiles it applies to in `quality_profiles.include`. A group-level `default: "true"` means it is synced automatically. Within an enabled group, a CF is synced if it is `required: true` or `default: true` (`RC:docs/decisions/product/005-cf-group-opt-in-semantics.md`, `006-cf-group-auto-sync-contract.md`).

Synced by default to **[German] HD Bluray + WEB**:

- `[Unwanted] Unwanted Formats German` (`TG:docs/json/radarr/cf-groups/unwanted-formats-german.json`), all at -35000:
  - Radarr: 3D, AV1, Black and White Editions, BR-DISK, Extras, German LQ, German LQ (release title), German Microsized, Line/Mic Dubbed, LQ, LQ (Release Title), Sing-Along Versions, Upscaled.
  - Sonarr has a similar list without 3D, Black and White Editions, Line/Mic Dubbed and Sing-Along Versions.
  - Opt-in only: No-RlsGroup, Obfuscated, Retags.
  - This group replaces the English `[Unwanted] Unwanted Formats`, which also contains "Bad Dual Groups" (a CF that penalises dual-audio groups), and so cannot be used with German profiles.
- `[Required] Golden Rule HD`: x265 (HD), scored 0 in the `german` set.
- `[Streaming Services] General`: AMZN, NF, DSNP and so on. Most score 0 in Radarr; all score 75 in Sonarr.

Also synced by default to **[German] UHD Bluray + WEB**:

- `[HDR Formats] HDR` (500).
- `[Required] Golden Rule UHD`: x265 (no HDR/DV), -35000.
- Radarr only: `[Audio] Audio Formats`, with TrueHD ATMOS 5000, DTS X 4500, DD+ ATMOS 3000, … down to DD 750. The guide prose calls audio "optional" for UHD, but the JSON has `default: true`. Recyclarr treats this mismatch as an upstream data bug and follows the JSON (`RC:docs/decisions/product/006-cf-group-auto-sync-contract.md`).

Opt-in groups that are relevant: `[Optional] German Miscellaneous` (German Subbed 9000), `[Optional] Miscellaneous`, `[Optional] Movie Versions` (IMAX 800 and others), HDR10+/DV boosts, SDR, accessibility, regional streaming sets, and `[Optional] Season Packs` (Sonarr).

### Recommendation for Kestrel's HD and UHD Profiles

- **HD Profile**: `[German] HD Bluray + WEB` (Radarr `2b90e905…`, Sonarr `dca7e5e9…`). It is the TRaSH default for German HD encodes, 720p/1080p, sized for a household library. The alternative is `[German] HD Remux + WEB` for 1080p remuxes, at much larger file sizes.
- **UHD Profile**: `[German] UHD Bluray + WEB` (Radarr `27cc3d15…`, Sonarr `3b0fa37f…`), the 2160p-only variant. In Kestrel the HD Version already covers the HD fallback, so the "(Alternative)" variant, which lets a UHD slot hold 1080p until 2160p appears, would duplicate the HD Version. The alternative is `[German] Remux + WEB 2160p` / `[German] UHD Remux + WEB` for remux collectors.
- Both are guide-backed profiles with matching Radarr and Sonarr variants, so one Kestrel Profile can map to a (Radarr profile, Sonarr profile) pair: the Radarr data for Movies and the Sonarr data for Series.
- Points for the Profile grilling ticket to decide:
  1. Does Kestrel keep TRaSH's "upgrade forever" behaviour (cutoffFormatScore 35000, min increment 1), or define a real Cutoff? An example of a real Cutoff is score ≥ 11000 + booster, meaning "German DL reached".
  2. Is German-only acceptable above English? TRaSH says yes; Kestrel's stated preference says no.
  3. Do default-on CF groups follow the JSON `default` flags, as Recyclarr does?

## 2. TRaSH JSON schema

The layout is declared in `TG:metadata.json`, whose `json_paths` field gives these directories per app: `custom_formats`, `qualities` (quality sizes), `naming`, `quality_profiles`, `custom_format_groups`, `quality_profile_groups`, `conflicts`. The JSON Schemas live in `TG:schemas/`.

**Custom format** (`TG:schemas/radarr-cf.schema.json`, `sonarr-cf.schema.json`, `base-cf.schema.json`):

```jsonc
{
  "trash_id": "32 hex chars",              // stable ID; "guide-only" for docs-only CFs
  "trash_scores": { "default": 11000, "german": 11000, ... },  // keyed by score set; "default" != 0
  "trash_regex": "uri (optional, regex101 link)",
  "trash_description": "optional",
  "name": "German DL",
  "includeCustomFormatWhenRenaming": true, // feeds the {Custom Formats} naming token
  "specifications": [                      // >= 1
    { "name": "German", "implementation": "LanguageSpecification",
      "negate": false, "required": true, "fields": { "value": 4 } }
  ]
}
```

These are Radarr/Sonarr API custom-format objects plus the `trash_*` fields. Recyclarr strips `trash_*` and POSTs the rest (`RC:src/Recyclarr.Core/ResourceProviders/Domain/CustomFormatResource.cs`).

Spec `fields` per implementation, from `TG:schemas/specs/*.json`:

| implementation | fields | Radarr | Sonarr |
|---|---|---|---|
| ReleaseTitleSpecification | `value`: regex | yes | yes |
| ReleaseGroupSpecification | `value`: regex | yes | yes |
| EditionSpecification | `value`: regex | yes | – |
| LanguageSpecification | `value`: int language id, `exceptLanguage`?: bool | yes | yes |
| SourceSpecification | `value`: 1–9 (Radarr) / 1–7 (Sonarr) | yes | yes |
| ResolutionSpecification | `value`: 360/480/540/576/720/1080/2160 | yes | yes |
| QualityModifierSpecification | `value`: 1–5 | yes | – |
| IndexerFlagSpecification | `value`: bit flag | yes | yes |
| SizeSpecification | `min`, `max` (GB) | yes | yes |
| YearSpecification | `min`, `max` | yes | – |
| ReleaseTypeSpecification | `value`: 0–3 | – | yes |

(The schema's `year-spec.json` has `implementation: const "SizeSpecification"`, which is an upstream copy-paste bug. No CF uses Year today.)

**Quality profile** (`TG:schemas/quality-profile.schema.json`): `trash_id`, `name`, `trash_description`, `trash_url`, `trash_score_set`, `group` (sort band; 11–19 = German), `upgradeAllowed`, `cutoff` (a quality or group name from `items`), `minFormatScore`, `cutoffFormatScore`, `minUpgradeFormatScore`, `language` (Radarr), `items` (ordered list of `{name, allowed, items?}`, where nested `items` makes a merged group), and `formatItems` (a map from CF name to trash_id: the base CFs, "additional CFs may be added via cf-groups"). A CF's score in a profile is `trash_scores[profile.trash_score_set]`, falling back to `trash_scores.default` (`RC:src/Recyclarr.Cli/Pipelines/Plan/Components/QualityProfilePlanComponent.cs`).

**CF group** (`TG:schemas/cf-groups.schema.json`): `name`, `trash_id`, `trash_description`, `default` ("true"/"false" string), `custom_formats: [{name, trash_id, required, default?}]`, and `quality_profiles.include: {profile name: profile trash_id}`. Groups used to use `exclude` and moved to fail-closed `include` lists (`RC:docs/decisions/product/001-cf-groups-exclude-to-include.md`).

**Other files**:

- `quality-profile-groups/groups.json` groups profiles for UIs.
- `conflicts.json` lists mutually exclusive CFs, for example SDR vs SDR (no WEBDL) and x265 (HD) vs x265 (no HDR/DV).
- `quality-size/*.json` holds min/preferred/max sizes per quality.
- `naming/*.json` holds the naming schemes.
- `docs/json/guide-only/` holds documentation-only CFs such as "Language: Prefer German", with `trash_id: "guide-only"`. These are not synced.

## 3. How Recyclarr consumes it

- **Fetch**: Recyclarr git-clones `https://github.com/TRaSH-Guides/Guides.git` (default refs `master`/`main`). Users can add or replace providers. Recyclarr reads `metadata.json`, then globs the JSON directories listed in `json_paths` (`RC:src/Recyclarr.Core/ResourceProviders/Infrastructure/TrashGuidesStrategy.cs`). It also parses `docs/Radarr/Radarr-collection-of-custom-formats.md` for CF categories.
- **Guide-backed profiles**: a user config entry `quality_profiles: - trash_id: <profile id>` loads the profile resource. Properties merge Service < Guide < Config. `score_set` and qualities are inherited from the guide unless overridden (`RC:docs/architecture/quality-profile-pipeline.md`, `QualityProfilePlanComponent.cs`).
- **Which CFs are synced** for a guide-backed profile (`RC:src/Recyclarr.Cli/Pipelines/CustomFormat/ConfiguredCustomFormatProvider.cs`):
  1. all of the profile's `formatItems`;
  2. every CF group with `default: "true"` whose `include` list contains the profile, unless the group is in `custom_format_groups.skip`, taking `required` CFs plus `default: true` CFs;
  3. groups the user adds explicitly via `custom_format_groups.add`, with `select` to pick optional CFs;
  4. any flat `custom_formats` entries the user lists.
- **Scores**: score set first, then `default`. Users can override per-CF scores in YAML.
- **Identity**: CFs and profiles are matched by `trash_id` first (state cache), then by name (`RC:docs/decisions/architecture/002-id-first-custom-format-matching.md`, `docs/architecture/trash-id-state-system.md`).

Kestrel's "bundled snapshot + update from TRaSH" can copy this model. Pull the repo (or a tarball of `docs/json` + `metadata.json` + `LICENSE`) and resolve profile → formatItems + default groups → scores via score set. Key everything by `trash_id`.

## 4. Condition types Kestrel must implement

**Used by CFs reachable from the German profiles** (the formatItems of all German profiles plus every CF group that includes them; 186 of 243 Radarr CFs, 169 of 236 Sonarr CFs):

| Condition | Uses (Radarr / Sonarr) | Notes |
|---|---|---|
| ReleaseTitle (regex) | 745 / 605 | |
| ReleaseGroup (regex) | 454 / 326 | runs against the *parsed* release group |
| Source | 168 / 230 | Radarr values 5,7,8,9; Sonarr 1,3–7 |
| Language | 19 / 19 | ids -2 (Original), 1 English, 4 German, 8 Japanese, 10 Chinese, 21 Korean; `exceptLanguage` appears only as `false` in current data |
| Resolution | 16 / 11 | 720/1080/2160 |
| QualityModifier | 20 / – (Radarr only) | value 5 = REMUX, mostly negated ("Not Remux") |
| IndexerFlag | 2 / 2 | FreeLeech, Internal |
| ReleaseType | – / 3 (Sonarr only) | Single Episode, Multi-Episode, Season Pack |

**Not used by any TRaSH CF today**: Size, Year and Edition. The schemas allow them, so the loader should parse them. Size is trivial (`min < size ≤ max` GB, `RR:CustomFormats/Specifications/SizeSpecification.cs`).

**Evaluation semantics** must match Radarr/Sonarr exactly (`RR:CustomFormats/CustomFormatCalculationService.cs`, `RR:CustomFormats/SpecificationMatchesGroup.cs`; Sonarr is identical):

- Specs are grouped **by implementation type**. A group matches unless (any `required` spec is false) or (all specs in the group are false). The CF matches if every group matches. In other words, required specs are ANDed, and non-required specs of the same type are ORed. This is how the 46-group "German LQ" list works: all its specs are non-required ReleaseGroup specs, so any one match triggers the CF.
- `negate` inverts the individual spec result before grouping.
- Regexes are .NET, compiled with `RegexOptions.IgnoreCase` (`RR:CustomFormats/Specifications/RegexSpecificationBase.cs`). ReleaseTitle matches against the *simplified* release title or the file name (`ReleaseTitleSpecification.cs`, `Parser.SimplifyReleaseTitle`).
- **Language semantics** (`RR:CustomFormats/Specifications/LanguageSpecification.cs`):
  - Value -2 (Original) resolves to the Title's original language from metadata. `exceptLanguage` means "any language other than X".
  - The release's languages come from the parser plus aggregation (`RR:Download/Aggregation/Aggregators/AggregateLanguages.cs`):
    - languages supplied by the indexer win over parsed ones;
    - words of the Title's own name are discounted;
    - if no language is parsed, it **falls back to the Title's original language**, which is why an untagged scene release counts as English;
    - an `Original` token is replaced by the Title's original language (or `Unknown` if that is already present).
  - **German DL rule** (`RR:Parser/LanguageParser.cs` lines 57–58 and 458–470; same in `SR:Parser/LanguageParser.cs` lines 211–224): if the only parsed language is German and the title matches `(?<!WEB[-_. ]?)\bDL\b`, Original is added. If it matches `\bML\b` instead, Original and English are added. This rule is what makes "German DL" mean "German + original audio".
- **Enumerations differ between the apps.** Kestrel must use per-kind tables, Radarr's for Movies and Sonarr's for Series:
  - Source: Radarr `QualitySource` is CAM 1, TELESYNC 2, TELECINE 3, WORKPRINT 4, DVD 5, TV 6, WEBDL 7, WEBRIP 8, BLURAY 9 (`RR:Qualities/QualitySource.cs`). Sonarr's is Television 1, TelevisionRaw 2, Web 3, WebRip 4, DVD 5, Bluray 6, BlurayRaw 7 (`SR:Qualities/QualitySource.cs`).
  - Radarr Remux is Source 9 + Modifier 5 (`RR:Qualities/Modifier.cs`: REGIONAL 1, SCREENER 2, RAWHD 3, BRDISK 4, REMUX 5).
  - IndexerFlags: Radarr G_Freeleech 1 … G_Internal 32 … G_Scene 128. Sonarr Freeleech 1 … Internal 8, Scene 16, Nuked 128.
  - TRaSH validates the per-app ranges in `TG:scripts/validate-source-specifications.py`.
- **Indexer flags on usenet**: the Newznab parsers set only Scene and Nuked (plus Subtitles in Sonarr) (`RR:Indexers/Newznab/NewznabRssParser.cs` `GetFlags`). The FreeLeech/Internal CFs therefore never match for a usenet-only Kestrel. That is harmless, but the flag condition should still be implemented for the Torznab seam.

**Implications beyond the CF evaluator:**

1. **Regex engine**: Go's `regexp` (RE2) has no lookaround. I compiled every TRaSH regex. Radarr has 1492 ReleaseTitle/ReleaseGroup patterns; 88 of them (in 59 CFs, including German Subbed, LQ (Release Title), audio and HDR CFs) fail under RE2. Sonarr has 1304, of which 71 (54 CFs) fail. All of them compile with [`github.com/dlclark/regexp2`](https://github.com/dlclark/regexp2) v1.12.0 (a port of the .NET engine, MIT). Kestrel should use regexp2 with `IgnoreCase` for CF regexes.
2. **Parser parity**: Source, Resolution, Modifier, ReleaseGroup and Language conditions run on *parsed* release attributes, not raw text. Faithful scoring therefore needs a release parser that matches Radarr/Sonarr on quality (source/resolution/modifier), release group, languages (with the German DL/ML rule and the original-language fallback), and release type for Series. That is a larger job than the CF evaluator itself, and it should be its own ticket.
3. **Quality model**: profile `items` and `cutoff` refer to Radarr/Sonarr quality names (for example `WEBDL-1080p`, `Bluray-2160p Remux` in Sonarr, `Remux-2160p` in Radarr). Kestrel needs both quality tables (`RR:Qualities/Quality.cs`, `SR:Qualities/Quality.cs`).
4. **Post-import rescoring**: the German guide warns that Radarr scores the release title before Import but the file's first audio track (via ffprobe) after Import, so scores can drop. For Adoption and Upgrade comparisons, Kestrel must decide whether to score files by scene name (as Radarr does when `SceneName` is known) or by media info.

## 5. License and bundling

- The TRaSH-Guides/Guides repository is under the **MIT License**, "Copyright (c) 2021 TRaSH" (`TG:LICENSE`). The repo has no separate data license, and the JSON lives in the same repo.
- Recyclarr is MIT too (`RC:LICENSE`, "Copyright (c) 2021 Robert Dailey"). Kestrel does not need Recyclarr code, only its model.
- MIT is compatible with GPLv3. Kestrel **may bundle a snapshot** of `docs/json` (plus `metadata.json` and the schemas) inside a GPLv3 binary, provided the MIT copyright notice and permission text ship with it. Practical steps:
  - include TRaSH's `LICENSE` next to the embedded snapshot and in the third-party notices;
  - record the snapshot's upstream commit hash.
- dlclark/regexp2 is MIT as well, so the same notice handling applies.
- Courtesy rather than requirement: credit TRaSH Guides and the German guide maintainers (Lokilicious, PCJones, LaurenceBarnes) in the UI or docs, and link back to the guide pages for CF descriptions.

## Open points handed to other tickets

- Profile grilling: Cutoff semantics (TRaSH upgrades forever), English vs German-only order, and whether to honour default-on CF groups including Radarr UHD audio.
- Release parser parity (quality, group, languages, release type) as an architecture item.
- Naming: German DL and German have `includeCustomFormatWhenRenaming: true`, which feeds a `{Custom Formats}` token. The guide also suggests `{Movie CleanTitle:de}` for German titles.
- Indexer matching of German titles and umlauts: the guide points to [UmlautAdaptarr](https://github.com/PCJones/UmlautAdaptarr) because German releases often use German titles without umlauts. This affects search, which belongs to the metadata/search ticket.
