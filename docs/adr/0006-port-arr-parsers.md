# Port the Radarr and Sonarr parsers instead of using a Go library

Kestrel parses release names with a Go port of Radarr's and Sonarr's parsers (`Parser`, `LanguageParser`, `QualityParser`, `ReleaseGroupParser`) and runs their test fixtures as its own. We chose this because TRaSH's Custom Formats are written against what those parsers output, above all the language set with "Original" that `DL`, `ML` and `MULTi` produce. A different parser would score differently on exactly the names that matter most. The port is GPL-3.0 like Kestrel, so it is license-compatible with attribution. Each ported file records the upstream commit it came from, so a later re-sync is a diff.

## Considered Options

- **autobrr/rls (MIT), patched.** It was the best Go library in testing, but it misses `ML`, `Ger`, SwissGerman, the provider-HD WEB sources, German remuxes and most French tokens. It would also need a translation layer to the *arr output and would keep drifting on edge cases.
- **Our own parser.** Rejected for the same drift, without fixtures to anchor it.

## Consequences

- All regexes, ported and from TRaSH, run on `dlclark/regexp2`, because Go's RE2 lacks lookaround. Each match has a timeout, and a timed-out spec counts as no match.
- One package serves both kinds. Language, quality, group and revision parsing are shared, and title, episode and pack parsing are kind-specific. Where the two apps' fixtures disagree, the kind breaks the tie.
- The parser recognises every *arr language and does not depend on the Primary Language.
- Sonarr's absolute-number anime patterns are left out. Their fixtures stay in the suite, marked as skipped.
- Parity is checked against pinned Radarr and Sonarr instances through `/api/v3/parse`, recorded as golden files that CI replays.
