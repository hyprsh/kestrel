# TMDB for Movies, TheTVDB for Series

Movies take all their metadata from TMDB. Series take their seasons and episodes from TheTVDB, in its official aired order, and use TMDB only for add-search, for turning TMDB IDs into TVDB IDs (including in Silo Requests), and to fill gaps in Series-level facts. We chose two providers over one because the download side numbers episodes the TheTVDB way: Newznab `tvsearch` takes a `tvdbid` with season and episode, TheXEM maps scene numbering onto TheTVDB, and libraries built by Sonarr carry TheTVDB numbering. Where TMDB and TheTVDB disagree, TheTVDB numbering costs one Plex setting ("TheTVDB (Aired)"), while TMDB numbering would make Kestrel search for and grab the wrong episodes.

## Considered Options

- **TMDB for both kinds.** One provider, Plex's default order and Silo's Request numbering. Rejected because indexer search and scene names follow TheTVDB, and nothing like TheXEM exists for TMDB.
- **TheTVDB for both kinds.** Rejected because TheTVDB's movie release dates are untyped, and Radarr, Plex, Silo and TRaSH all key Movies on TMDB.

## Consequences

- The primary ID is TMDB for Movies and TVDB for Series. Every Title also stores the other IDs it has, and folder tags follow the primary ID (`{tmdb-N}`, `{tvdb-N}`).
- Episode text never falls back to TMDB, because its numbering can differ from TheTVDB's.
- A Series that exists on TMDB but not on TheTVDB can't be added in v1.
