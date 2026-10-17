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
