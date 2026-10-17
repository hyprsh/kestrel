# Parser test data

The Movie parser in `internal/release` is a Go port of Radarr's parser
([ADR 0006](../../../docs/adr/0006-port-arr-parsers.md)). Both data sets below
come from the same pinned upstream.

| | |
|---|---|
| Upstream | [Radarr/Radarr](https://github.com/Radarr/Radarr), the last v5 release (PRD Settled 26) |
| Release | `v5.28.0.10274` |
| Commit | `54cbbe05d976ac053744012f8b48d44e384e2d41` |
| Image used for the golden files | `ghcr.io/hotio/radarr:release-5.28.0.10274` |
| Image digest | `sha256:42ca21d9bab4df84af1898e7256256b85a04b207e72c620ac382ac4151d65dd0` |

The commit is also in `release.UpstreamRadarr`, and every ported file names it in
its header, so a later re-sync is a diff. `radarr-parse.json` repeats the
version, commit and image digest it was recorded from, and a test fails if they
drift from the constants. Radarr and the port are both GPL-3.0.

## `radarr/` : upstream fixtures, replayed as Go tests

`radarr/<Fixture>.json` holds the `[TestCase]` and `[TestCaseSource]` rows of
Radarr's own NUnit suites from `src/NzbDrone.Core.Test/ParserTests/`, extracted
unchanged: `ParserFixture`, `LanguageParserFixture`, `QualityParserFixture`,
`ReleaseGroupParserFixture`, `EditionParserFixture`, `NormalizeTitleFixture`,
`HashedReleaseFixture`, `CrapParserFixture` and `ExtendedQualityParserRegex`.
`radarr_fixtures_test.go` runs every row. A test method with no Go handler fails
the suite.

Skipped, with the reason in `skippedMethods`: the subtitle file name tests in
`LanguageParserFixture` (sidecar subtitles are not release names).

Regenerate (needs a Radarr checkout at the pinned tag, in a scratch directory):

```sh
git clone --depth 1 --branch v5.28.0.10274 https://github.com/Radarr/Radarr.git /tmp/radarr-src
go run ./scripts/portfixtures -src /tmp/radarr-src/src/NzbDrone.Core.Test/ParserTests \
  -out internal/release/testdata/radarr \
  ParserFixture LanguageParserFixture QualityParserFixture ReleaseGroupParserFixture \
  EditionParserFixture NormalizeTitleFixture HashedReleaseFixture CrapParserFixture \
  ExtendedQualityParserRegex
```

## `golden/` : recorded `/api/v3/parse` answers

`golden/radarr-parse.json` holds Radarr's `parsedMovieInfo` for a broad corpus
of Movie names, including German and French dual-language names (DL, ML, MULTi,
TRUEFRENCH, VFF, VOSTFR), editions, remuxes, multi-part names and unparseable
junk. The corpus is every title in the fixture files plus
`golden/corpus-extra.txt`. `golden_test.go` replays the file offline, with no
Docker and no Radarr, and requires the port to match field for field.

Regenerate (dev only, needs Docker and network, never run in CI):

```sh
scripts/regen-radarr-golden.sh
```

The script starts the pinned container, asks it to parse every name and writes
the file. It refuses to record from a Radarr that is not the pinned version.

# Series parser (Sonarr)

The Series parser is a Go port of Sonarr's parser, from its own pin (PRD
Settled 26: the latest Sonarr v4 release). Quality and language parsing are
Sonarr's, not Radarr's: the two programs differ (other regexes, no modifiers, a
remux is a quality of its own, other quality ids), so Series names run through
`qualityparser_sonarr.go` and `languageparser_sonarr.go`.

| | |
|---|---|
| Upstream | [Sonarr/Sonarr](https://github.com/Sonarr/Sonarr), the latest v4 release (PRD Settled 26) |
| Release | `v4.0.20.3014` |
| Commit | `cab419ade8ac7fcab5bf80394ee492abd35d5f5a` |
| Image used for the golden files | `ghcr.io/hotio/sonarr:release-4.0.20.3014` |
| Image digest | `sha256:afc94d6134d3e21162bc86b82afee332c7555bedf4a29b710edcd794c9c38e1d` |

The commit is in `release.UpstreamSonarr`, in every ported file's header, and in
`golden/sonarr-parse.json`, which a test checks against the constant. The 98
report-title regexes and 12 pre-substitutions in `seriesparser_regex.go` were
copied from `Parser.cs` by script, not retyped; their order is meaningful.

## `sonarr/` : upstream fixtures, replayed as Go tests

`sonarr/<Fixture>.json` holds the `[TestCase]` and `[TestCaseSource]` rows of
Sonarr's own NUnit suites, extracted unchanged. `sonarr_fixtures_test.go` runs
every row; a test method with no Go handler fails the suite. The `[Test]`
methods that have no rows are not extracted and are ported by hand in the same
file.

Skipped, with the reason in `sonarrSkipped`:

- Anime absolute episode numbering is out of scope (PRD Release parsing):
  `AbsoluteEpisodeNumberParserFixture` and `UnicodeReleaseParserFixture`, whose
  every assertion is an absolute episode number. The parser still reads
  absolute numbers (Sonarr's grammar needs them to tell such names apart) and
  `ParsedRelease.IsAbsoluteNumbering` lets Decide reject them.
- The subtitle file name tests in `LanguageParserFixture`.

Regenerate (needs a Sonarr checkout at the pinned tag, in a scratch directory):

```sh
git clone --depth 1 --branch v4.0.20.3014 https://github.com/Sonarr/Sonarr.git /tmp/sonarr-src
go run ./scripts/portfixtures -src /tmp/sonarr-src/src/NzbDrone.Core.Test/ParserTests \
  -out internal/release/testdata/sonarr \
  SingleEpisodeParserFixture MultiEpisodeParserFixture SeasonParserFixture \
  DailyEpisodeParserFixture MiniSeriesEpisodeParserFixture PathParserFixture \
  ParserFixture LanguageParserFixture QualityParserFixture ReleaseGroupParserFixture \
  NormalizeSeriesTitleFixture NormalizeEpisodeTitleFixture IsPossibleSpecialEpisodeFixture \
  UnicodeReleaseParserFixture HashedReleaseFixture CrapParserFixture \
  ExtendedQualityParserRegex AbsoluteEpisodeNumberParserFixture \
  AnimeMetadataParserFixture AnimeVersionFixture
```

## `golden/sonarr-parse.json` : recorded `/api/v3/parse` answers

Sonarr's `parsedEpisodeInfo` for every release name in the fixture files plus
`golden/corpus-extra-series.txt` (German and French dual-language names,
packs, multi-episode, daily, specials, split episodes, hashes). It is replayed
offline by `golden_series_test.go`, which requires the port to match field for
field. Languages are compared by name, because Sonarr numbers its languages
differently from Radarr; Kestrel keeps one language table.

Regenerate (dev only, needs Docker and network, never run in CI):

```sh
scripts/regen-sonarr-golden.sh
```

The dates in daily names are compared against the clock at replay time (Sonarr
rejects an air date after tomorrow), so the corpus holds only past dates and
one far-future date that both sides reject.
