# TMDB vs TVDB for metadata

Research for [#6](https://github.com/hyprsh/kestrel/issues/6), feeding the "Metadata source" decision. Researched 2026-10-17 against primary sources: provider docs and terms, Plex and Silo docs, and the source code of Silo, Jellyfin, Radarr and Sonarr. Terms follow `GLOSSARY.md` (Title, Movie, Series, Upcoming, Request, Adoption).

## Summary

- **Movies: TMDB, and it is not close.** Radarr, Plex's movie agent, Silo and TRaSH naming all key Movies on TMDB IDs. TMDB has typed, per-country release dates (theatrical, digital, physical, with the German FSK rating), which is what Upcoming and availability need. TheTVDB's movie data is thinner: free-text release records.
- **Series: either works, and the choice is a trade-off.**
  - **TVDB** matches the release ecosystem. Sonarr, TheXEM scene mappings, TRaSH's `{tvdb-…}` folder tag and Silo's series identity anchor all use it. Its alternate orders (DVD, absolute and others) are a built-in feature of the data.
  - **TMDB** is Plex's *default* episode order and the ID and season numbering Silo Requests use. Using it for Series too means one provider, one key and one client for both kinds.
- **Cost and keys:** both are free for Kestrel. TMDB is free for non-commercial use with attribution. TheTVDB is free with attribution for projects under $50k a year in revenue. Shipping one project key in open-source code is established practice for both (Jellyfin and Silo do it), but neither provider's terms explicitly allow it.
- **Rate limits:** TMDB's limit is about 40 requests per second. TheTVDB publishes no numeric limit and tells clients to cache aggressively or mirror its data.
- **The *arr proxies (Skyhook, api.radarr.video)** are closed-source servers run by the Servarr team. They sit between every Sonarr and Radarr install and the upstream provider. The source and docs show they cache, join several providers' data (ratings, cross-IDs, network timezones) and work out derived fields such as Radarr's In Cinemas, Digital and Physical dates. A self-hosted single-household app doesn't need one: it can call TMDB or TVDB directly and cache locally.

## 1. API terms, keys and cost

### TMDB

- **Price:** "Our API is free to use for non-commercial purposes as long as you attribute TMDB as the source of the data and/or images." A project counts as commercial "if the primary purpose is to create revenue for the benefit of the owner." ([TMDB FAQ](https://developer.themoviedb.org/docs/faq)) Kestrel is GPLv3 with no revenue, so it is non-commercial.
- **Attribution** (required as a licence condition, [Terms §1.B, §3](https://www.themoviedb.org/api-terms-of-use)):
  - Use an approved TMDB logo, less prominent than Kestrel's own branding.
  - Show the notice "This product uses the TMDB API but is not endorsed or certified by TMDB."
  - Put both in an About or Credits section.
- **Caching:** "[Do not] cache, for longer than 6 months, any information obtained through or from TMDB" ([Terms §1.C](https://www.themoviedb.org/api-terms-of-use)). Kestrel's SQLite copy of Title metadata needs a refresh cycle well inside six months. Kestrel needs that anyway.
- **Termination:** TMDB may end the licence "at any time for any reason". After that, all TMDB content must be purged, including cached content (§1.D).
- **Keys:** a v3 `api_key` query parameter, or a v4 "API Read Access Token" sent as a Bearer header. Both give the same read access ([Authentication](https://developer.themoviedb.org/docs/authentication-application)).
  - The terms say nothing about embedding a key in open-source code. The licence is "non-transferable, non-sublicensable" (§1.A).
  - **Precedent:** Jellyfin hard-codes a project key (`MediaBrowser.Providers/Plugins/Tmdb/TmdbUtils.cs`, `ApiKey` constant) and lets users override it in plugin config. Silo's TMDB plugin hard-codes `defaultAPIKey` (`provider/client.go`). Radarr hard-codes a v4 Bearer token (`src/NzbDrone.Common/Cloud/RadarrCloudRequestBuilder.cs`).
- **Changes feed:** `/movie/changes` (and the TV equivalent) lists IDs changed in the past 24 hours, queryable "up to 14 days at a time" ([Changes](https://developer.themoviedb.org/reference/changes-movie-list)). This is useful for cheap incremental refresh.

### TheTVDB (API v4)

- **Licensing tiers** ([api-information](https://thetvdb.com/api-information), [signup](https://thetvdb.com/api-information/signup)), by company or project revenue:

  | Revenue per year | Price |
  |---|---|
  | Under $50k | Free, attribution required |
  | $50k to $250k | $1,000 a year |
  | $250k to $1M | $10,000 a year |
  | Over $1M | Negotiated |

  Kestrel falls in the free tier. An account is needed to request a key.
- **Two key models** ([v4-api README](https://github.com/thetvdb/v4-api)):
  - A negotiated licence key, which is the free tier above for Kestrel.
  - A "subscriber-supported API key that requires that each of your users has a $12/year TheTVDB subscription". The user's subscriber PIN goes in `/login` alongside the apikey. The subscription page lists $11.99 a year and the PIN as "(not required for most projects)" ([subscribe](https://thetvdb.com/subscribe)).
- **Attribution:** "attribution with a direct link to TheTVDB.com must be displayed to end users viewing metadata from our API". The sample text is "Metadata provided by TheTVDB. Please consider adding missing information or subscribing." ([api-information](https://thetvdb.com/api-information))
- **Auth flow:** `POST /login` takes `apikey`, plus `pin` "if you have a user-supported key" ([swagger](https://thetvdb.github.io/v4-api/swagger.yml)). It returns a Bearer token. Client libraries and spec mirrors put the token's lifetime at one month. The official README doesn't state it, so treat it as likely rather than confirmed.
- **Caching:** TheTVDB "strongly recommend[s] maintaining your own copy of the database or making use of a caching proxy". Stable endpoints can be cached "for a week or even longer" ([README](https://github.com/thetvdb/v4-api)). An `/updates` endpoint supports incremental sync.
- **Precedent for embedded keys:**
  - Jellyfin's TVDB plugin hard-codes `ProjectApiKey` and has an optional `SubscriberPIN` setting (`Jellyfin.Plugin.Tvdb/Configuration/PluginConfiguration.cs`, `TvdbClientManager.cs`).
  - Silo's TVDB plugin hard-codes `defaultAPIKey` and can go through a "Silo metadata proxy" (`provider/client.go`, `proxyPathPrefix = "/v1/tvdb/4"`). Its README says "no plugin-specific configuration is required".
- **Ownership:** TheTVDB "does not claim ownership" of the data or images. The data comes from user contributions ([api-information](https://thetvdb.com/api-information)).

### Implication for Kestrel

Both providers allow a free key for a non-commercial GPLv3 app, if attribution is shown in the UI. Kestrel could ship one project key per provider, as Jellyfin and Silo do, and let the household override it in settings. Or it could make entering a key part of first-run setup, which goes against the three-step first run. Shipping a key in source code is tolerated practice, not something either provider's terms grant. The risk is that a provider revokes a widely shared key. A user-override setting mitigates that.

## 2. Rate limits

- **TMDB:** "They sit somewhere in the 40 requests per second range," and may change. The old limit of 40 requests per 10 seconds was removed on 2019-12-16. Clients must respect HTTP 429 ([Rate limiting](https://developer.themoviedb.org/docs/rate-limiting)). The terms also bar "excessive" bandwidth at TMDB's discretion (§1.C).
- **TheTVDB:** no published numeric limit in the v4 README, the swagger or the api-information page. The guidance is to cache and mirror. Third-party write-ups that cite daily caps don't agree with each other or with official sources, so don't rely on them.
- **Real-world latency** (from Sonarr's docs): "TVDb has a 1-3 hour cache on their API", plus up to an hour of CDN caching. Changes on TheTVDB typically take 3 to 19 hours to reach Sonarr ([Sonarr FAQ, wiki source](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)).
- **Silo** backs off for up to 15 minutes when a provider reports too many requests ([Silo docs: metadata](https://siloserver.org/docs/metadata)).

For one household's library (hundreds to low thousands of Titles), neither limit binds if Kestrel caches and refreshes incrementally.

## 3. Episode ordering (aired vs DVD vs absolute)

- **TheTVDB:** alternate orders are part of the data model. `/series/{id}/episodes/{season-type}` takes `default`, `official` (aired), `dvd`, `absolute`, `alternate` or `regional` ([swagger](https://thetvdb.github.io/v4-api/swagger.yml)). "The series base record includes the id of the default season order, which is generally 'Aired Order'". Season types can carry names, such as "Netflix" for Money Heist ([README](https://github.com/thetvdb/v4-api)).
- **TMDB:** each series has one season and episode structure, which is aired order. Alternate orders come from community-made **episode groups** (`/tv/{id}/episode_groups`). The group types are 1 Original air date, 2 Absolute, 3 DVD, 4 Digital, 5 Story arc, 6 Production and 7 TV ([Episode group details](https://developer.themoviedb.org/reference/tv-episode-group-details)). Groups exist only where someone has created them.
- **Plex:** "By default, the Plex TV Series agent uses TMDB's aired order. If your files are named according to TheTVDB, change the Episode Ordering setting." The options include TMDB (Aired), TheTVDB (Aired), TheTVDB (DVD) and TheTVDB (Absolute), set per library or, since PMS 1.40.4, per show ([Plex: naming TV shows](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/)).
- **Silo:** metadata providers are a per-library chain set in Admin > Libraries, and both TMDB and TVDB plugins are installed by default ([Silo docs](https://siloserver.org/docs/metadata), plugin READMEs). Silo's Request code notes that "A library whose metadata provider numbers seasons differently from TMDB (absolute or TVDB order) can therefore leave a season request waiting" ([media-requests.md](https://github.com/Silo-Server/silo-server/blob/main/docs/architecture/media-requests.md)). Requests count seasons TMDB's way.
- **Sonarr and the scene:** Sonarr numbers episodes by TheTVDB. It uses TheXEM to map scene (release) numbering onto TheTVDB numbering where they disagree, as with American Dad, double episodes or year-numbered seasons ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)). Sonarr v5 (pre-release; commit `b4e9ab1`, Feb 2026, "Translations and Episode Order") adds per-Series metadata language and a choice of TheTVDB season type. Stable v4 uses aired order and English only.
- **For Kestrel:** absolute numbering mostly matters for anime, which is out of scope. The live risk is Kestrel's `SxxEyy` file names disagreeing with the library's metadata order:
  - Naming by TMDB order matches Plex's default and Silo's request seasons.
  - Naming by TVDB order matches scene releases and Sonarr-built libraries (relevant to Adoption). Plex then needs "TheTVDB (Aired)" set on the library.
  - For most live-action series the two orders agree.

## 4. German metadata coverage

- **TMDB:** "most of our metadata endpoints support translated data". The exceptions are person names and characters. Languages use ISO 639-1, usually paired with a country (`de-DE`) ([Languages](https://developer.themoviedb.org/docs/languages)). Movies and series have translations and per-country alternative titles. Release dates are per country with certifications, so Germany gets its FSK rating (§6). Radarr uses TMDB translations and alternative titles for matching: "Parsing (i.e. importing) looks for a match in all Translations and Alternative Titles" ([Radarr FAQ](https://github.com/Servarr/Wiki/blob/master/radarr/faq.md)).
- **TheTVDB:** translations exist per series, season, episode, movie and person (`/{entity}/{id}/translations/{language}`, [swagger](https://thetvdb.github.io/v4-api/swagger.yml)). A German series such as *Der Tatortreiniger* has German episode titles under aired, DVD and absolute orders ([TheTVDB season page](https://www.thetvdb.com/series/crime-scene-cleaner/seasons/official/1)), but English episode translations were not visible there.
  - Stable Sonarr syncs English episode titles only: "If there is no English translation, then the episode title will be TBA". Sonarr "cannot add any series that does not have an English language title" ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)). These are Sonarr's choices, not limits of TheTVDB.
- **Gap:** neither provider publishes coverage statistics per language. This research did not measure German coverage across a sample of Titles, because no API key was available. If German overviews and titles matter beyond release matching, check this against the household's own library once a key exists.
- **Kestrel mainly needs metadata for:**
  - release matching: original, English and German titles, aliases and year
  - Upcoming: air dates and release dates
  - folder naming: English or original title, year and ID

  Plex and Silo fetch their own display metadata (overviews, artwork) in whatever language they're set to. So Kestrel's German needs come down to **German titles and aliases** for matching German DL releases, plus **German release dates**. Both providers cover titles and aliases. TMDB is stronger on dates.

## 5. Which IDs Plex and Silo match on

### Plex

- **Movies:** folder or file hint `{tmdb-272}` or `{imdb-tt0372784}`, with the current Plex Movie agent. The docs don't mention `{tvdb-}` for movies ([Plex: naming movies](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)). Editions use `{edition-…}` (Plex Pass), which can be combined with an ID tag.
- **Series:** the show folder takes `{tmdb-123456}`, `{tvdb-123456}` or `{imdb-tt123456}`, or a `.plexmatch` file ([Plex: naming TV shows](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/)).

### Silo

Silo is AGPL, a Go server with Jellyfin-compatible APIs, at [github.com/Silo-Server](https://github.com/Silo-Server).

- **Tag parsing:** "Silo reads TMDB, TVDB, and IMDb IDs. It never reads a bare number as an ID." A movie can carry its ID in the file name. "A show needs the ID in the show folder's name" ([Silo docs: media folders](https://siloserver.org/docs/media-folders)). The parser (`internal/naming/folderid.go`) accepts all three bracket styles and both key spellings: `(…)`, `[…]` and `{…}`, with `tmdb|tmdbid|imdb|imdbid|tvdb|tvdbid` and `-` or `=`. So Plex-style `{tvdb-81189}` and Jellyfin-style `[tvdbid-81189]` both work.
- **Identity:** Silo derives each Title's identity from provider IDs ([deterministic-content-id.md](https://github.com/Silo-Server/silo-server/blob/main/docs/architecture/deterministic-content-id.md)):
  - Movies use `movie-tmdb-…`, with precedence tmdb, then imdb, then tvdb.
  - Series, seasons and episodes use `series-tvdb-…`, with precedence tvdb, then tmdb, then imdb ("TVDB is episode-canonical").
- **Folder tags in naming:** a TVDB-only tag isn't evidence of a movie, "because Sonarr adds the show's TVDB ID to series folders" ([media-naming.md](https://github.com/Silo-Server/silo-server/blob/main/docs/architecture/media-naming.md)).
- **Requests:** Silo Requests are keyed by TMDB ID for both Movies and Series. The descriptor sent to a request-router plugin carries `external_ids` with `tmdb`, and `tvdb` and `imdb` when known, plus season numbers in TMDB numbering (`internal/requests/provider.go`, `media-requests.md`). Kestrel's Request path will receive a TMDB ID for every Request, including Series.

### TRaSH naming (the project's naming reference)

- **Movies:** Plex `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`. "TMDb is usually better as it guarantees a match" ([TRaSH Radarr naming](https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/)).
- **Series:** Plex `{Series CleanTitleWithoutYear} {(Series Year)} {tvdb-{TvdbId}}`. "TVDb is usually better as it guarantees a match". Jellyfin series support `[tvdbid-…]` only, with no IMDb ([TRaSH Sonarr naming](https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/)).
- **One folder scheme for both servers:** `Title (Year) {tmdb-N}` for Movies and `Title (Year) {tvdb-N}` (or `{tmdb-N}`) for Series is parsed by both Plex and Silo.

### Cross-referencing

- **TMDB `/find/{external_id}`** accepts `imdb_id`, `tvdb_id`, `wikidata_id` and others ([Find by ID](https://developer.themoviedb.org/reference/find-by-id)). TMDB series carry `external_ids` that include `tvdb_id`.
- **TheTVDB** offers `/search/remoteid/{id}`, and its records carry `remoteIds` (IMDb, TMDB, EIDR and so on) ([swagger](https://thetvdb.github.io/v4-api/swagger.yml)).
- **Either way**, Kestrel can store all three IDs per Title whichever provider is primary.

### Indexers

- **Sonarr** sends whichever of `tvdbid`, `tmdbid`, `imdbid`, `tvmazeid` and `rid` the Newznab indexer advertises.
- **Radarr** sends `imdbid` and `tmdbid` (`NewznabRequestGenerator.cs` in each repo).

Having the TVDB and IMDb IDs on hand improves ID-based Newznab search no matter which provider is primary.

## 6. Movie release dates (Upcoming and availability)

- **TMDB** `GET /3/movie/{id}/release_dates` returns, per country (`iso_3166_1`), a list of `{certification, descriptors, iso_639_1, note, release_date, type}` ([Release dates](https://developer.themoviedb.org/reference/movie-release-dates)). The `type` values:

  | Value | Release type |
  |---|---|
  | 1 | Premiere |
  | 2 | Theatrical (limited) |
  | 3 | Theatrical |
  | 4 | Digital |
  | 5 | Physical |
  | 6 | TV |

  `note` is free text, such as "Netflix" or "DVD". TMDB's contribution rules define Physical as VHS, DVD or Blu-ray, and Digital as streaming, VOD rental or purchase, and online festivals ([quoted in the Radarr FAQ](https://github.com/Servarr/Wiki/blob/master/radarr/faq.md)). Kestrel can read the DE entry directly (German cinema, digital and Blu-ray dates and the FSK rating) and fall back to US or earliest-anywhere.
- **TheTVDB movies:** `MovieExtendedRecord.releases[]` holds `{country, date, detail}` with no type code, plus `first_release` ([swagger](https://thetvdb.github.io/v4-api/swagger.yml)). It can't reliably tell digital from physical from theatrical.
- **Radarr's model** (the proxy delivers `InCinema`, `DigitalRelease` and `PhysicalRelease`, from `SkyHookProxy.MapMovie`):
  - Status is Announced. It becomes InCinemas once the cinema date has passed. It becomes Released once the physical or digital date has passed, or 90 days after the cinema date when neither exists.
  - "Minimum Availability" is Announced, In Cinemas or Released. The FAQ recommends Released with an Availability Delay of -14 or -21 days ([Radarr FAQ](https://github.com/Servarr/Wiki/blob/master/radarr/faq.md)).
  - Radarr takes the year from "the oldest **Theatrical Release** date", which suggests the proxy collapses all countries to the earliest date.
  - The proxy is closed source, so the country logic can't be confirmed.
  - Kestrel doing this itself with TMDB data can pick German dates on purpose. That matters for German DL releases, which tend to follow the German digital or Blu-ray date.
- **Series dates for Upcoming:**
  - Both providers give per-episode air dates.
  - TheTVDB gives air dates in the primary network's local time. Sonarr's Skyhook adds a network-to-timezone mapping that Sonarr maintains ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)).
  - TMDB episodes carry `air_date` as a date only, with no time.
  - Either way, Kestrel has dates at day precision. An "aired" check needs a time-of-day or timezone rule.

## 7. Radarr and Sonarr metadata proxies

| | Sonarr "Skyhook" | Radarr metadata server |
|---|---|---|
| Base URL in client | `https://skyhook.sonarr.tv/v2/tvdb/{route}/` (`SonarrCloudRequestBuilder.cs`) | `https://api.radarr.video/v1/{route}` (`RadarrCloudRequestBuilder.cs`) |
| Upstream | TheTVDB | TMDB (Radarr also calls `api.themoviedb.org` directly with an embedded Bearer token for some calls) |
| Routes used | `shows/{lang}/{tvdbId}/{seasonType}`, `search?term=…&language=…` with `imdb:`, `tmdb:`, `mal:` and `anilist:` lookups | `movie/{id}`, `movie/bulk`, `movie/imdb/{id}`, `movie/collection`, `movie/changed`, `search`, `list/tmdb/trending`, `list/tmdb/popular` |
| Adds on top of upstream | Cross-IDs (`TmdbId`, `TvMazeId`, `TvRageId`, `MalIds`, `AniListIds`, `ImdbId`), network timezone mapping, season types, translations | Computed `InCinema`, `DigitalRelease`, `PhysicalRelease`, `Premier` dates, aggregated ratings, translations, alt titles, certifications per country, recommendations, collections |
| Source available? | No | No. Only archived predecessors (`Radarr/RadarrAPI.TMDB`, archived 2020) |

**Why they exist:**

- **Documented in the sources:**
  - *Caching and shielding upstream.* "Sonarr's Skyhook has a much smaller few hour cache on top of [TVDB's]". Every install refreshes every 12 hours through the proxy ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)).
  - *Enrichment and normalisation.* The network timezone mapping is maintained by the Sonarr team "in Skyhook" ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)). Radarr's availability dates and ratings come out of the proxy ready-made (`SkyHookProxy.cs`).
- **Inferred from the design, not stated by the projects:**
  - *One upstream key and licence for a very large install base.* One licensed key sits server-side instead of being shipped in every client.
  - *Decoupling.* The Servarr team can change upstream providers or API versions (TheTVDB v2 to v4, for example) without a client release.
  - *Cheap bulk refresh.* `movie/bulk` and `movie/changed` answer many Titles in one request.
- **The cost:** a central point of failure. "In the event that TheTVDb is unavailable Sonarr is unable to get search results" ([Sonarr FAQ](https://github.com/Servarr/Wiki/blob/master/sonarr/faq.md)). There is also hidden logic that users can't inspect.
- **Silo** has an optional metadata proxy too, for TheTVDB (`proxyMode` in the TVDB plugin).

**For Kestrel:** a single-household install calling TMDB or TVDB directly, with SQLite caching and the providers' changes or updates feeds, needs no proxy. Running a hosted proxy would add an ops burden the project doesn't want. Kestrel can't reuse the Servarr proxies either: they are undocumented, private APIs for Sonarr and Radarr.

## 8. What the "Metadata source" decision needs

1. **Movies:** TMDB as the primary source. It has typed per-country release dates, is the de facto Movie ID across Radarr, Plex, Silo and TRaSH, and is free for Kestrel.
2. **Series:** pick one.
   - **(a) TMDB for Series too.** One provider, key and client. Plex's default order. The same ID and season numbering as Silo Requests. Weaker for alternate orders (community episode groups) and for scene-numbering corrections (TheXEM maps scene numbering onto TheTVDB, not TMDB).
   - **(b) TheTVDB for Series.** Matches Sonarr, TheXEM, TRaSH's `{tvdb-}` tag and Silo's series identity anchor, which helps Adoption of Sonarr-built libraries. First-class DVD and absolute orders. Costs a second provider, client, key and attribution, plus TheTVDB's slower update path. Plex libraries must be switched to "TheTVDB (Aired)", and Silo Requests (TMDB ID and TMDB seasons) must be translated to TVDB.
3. **Either way:**
   - Store TMDB, TVDB and IMDb IDs on every Title (both providers cross-reference).
   - Put one ID tag in the folder name in `{source-id}` form, which Plex and Silo both read.
   - Ship an embedded project key per provider with a settings override.
   - Show attribution (TMDB logo and notice; TheTVDB link and text) in an About screen.
   - Refresh well inside TMDB's six-month cache limit.
   - Build movie availability from TMDB `release_dates` with a configurable country, DE by default with fallback.
4. **Open check before relying on German overviews:** sample the household's library against both APIs once a key exists. No primary source publishes coverage for German.
