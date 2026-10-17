# Silo integration surface

Research for [#4](https://github.com/hyprsh/kestrel/issues/4). Throwaway branch, never merged.

Question: how Silo integrates with Radarr and Sonarr today, how it handles separate HD and 4K servers for Requests, which arr endpoints it calls, what its plugin system and open API offer, and what Kestrel needs to look like an "HD Radarr", a "UHD Radarr" and a Sonarr to Silo, compared with a Silo plugin that talks to a native Kestrel Request API.

## Sources

All read on 2026-10-17. Code was read at these commits:

| Source | Commit | Why |
| --- | --- | --- |
| [Silo-Server/silo-server](https://github.com/Silo-Server/silo-server) | `5d1ab2ba` | Host: Request lifecycle, quality tiers, routing, v2 OpenAPI |
| [Silo-Community/silo-plugins-requests-arr](https://github.com/Silo-Community/silo-plugins-requests-arr) | `88c95f50` | The plugin that talks to Radarr/Sonarr for Requests (catalog id `silo.requests.arr`) |
| [Silo-Server/silo-plugin-sdk](https://github.com/Silo-Server/silo-plugin-sdk) | `aa8df5e0` | `request_router.v1` gRPC contract |
| [Silo-Server/silo-plugins](https://github.com/Silo-Server/silo-plugins) | `1fafb2f4` | Plugin catalog `manifest.json` |
| [Silo-Server/silo-plugin-autoscan-arr](https://github.com/Silo-Server/silo-plugin-autoscan-arr) | `74b6c5cd` | Library rescans from arr history |
| [Silo-Community/silo-plugins-requests-seerr](https://github.com/Silo-Community/silo-plugins-requests-seerr) | `71e20d87` | The other request router, for comparison |
| [Silo-Server/siloserver.org](https://github.com/Silo-Server/siloserver.org) | `3dc3670c` | User docs (published at siloserver.org/docs) |
| Radarr [`openapi.json`](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json), Sonarr [`openapi.json`](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json) | `develop` | Check every endpoint and field Silo uses |

Paths below are relative to the repository named in each heading.

## 1. How Silo integrates today

Silo has **its own Request feature**, built into the server and not a plugin. Users browse and search TMDB-backed discovery rows, press Request, and admins approve or decline in a queue. There are per-user and per-group quotas, auto-approval, watchlist-triggered Requests and season Requests. A Request is fulfilled once the title is in a Silo library and matched ([docs: Manage media requests](https://siloserver.org/docs/manage-requests); `silo-server/internal/requests/`).

Silo **does not call Radarr or Sonarr itself** for Requests. The host hands an approved Request to a `request_router.v1` plugin. The host keeps the Request lifecycle, approvals, quotas, quality governance and target records. The plugin picks the instance, submits, and reports status (`silo-plugin-sdk/proto/silo/plugin/v1/request_router.proto`, header comment on `service RequestRouter`). The catalog lists two request routers (`silo-plugins/manifest.json`):

- `silo.requests.arr`, "Sonarr / Radarr": multi-instance Radarr/Sonarr. It is an approved community plugin in the `Silo-Community` org, AGPL-3.0. Its README says the arr logic was "relocated from the silo-server host" (`internal/arr/types.go` package comment).
- `silo.requests.seerr`: forwards Requests to a Seerr/Overseerr/Jellyseerr instance, which runs its own Radarr/Sonarr. HD becomes `is4k:false` and 2160p becomes `is4k:true` (README).

Silo's host still has a small arr client of its own (`internal/requests/arrclient`). It calls `GET /api/v3/rootfolder`, `/qualityprofile` and `/tag` for admin forms, and `GET /api/v3/system/status` to probe autoscan connections (`internal/autoscan/suggest_deps.go`).

The Request docs say outright that "external services are optional". With no router, an approved Request waits until the title shows up in the library (`internal/requests/library_completion_test.go`, `TestApprovedRequestWithoutRouterCompletesFromLibrary`).

### Data flow for one Request

1. A user creates it with `POST /api/v2/requests`. The body has `media_type`, `tmdb_id` and `title` (required), plus optional `tvdb_id`, `imdb_id`, `year`, `seasons`, `overview`, `poster_path` and `backdrop_path`. **There is no quality field** (`contracts/api/v2/openapi.json`, schema `MediaRequestCreate`).
2. Approval, manual or automatic.
3. The host works out the **quality tiers**. There are only two, `1080p` and `2160p` (`internal/requests/types.go:46-51`). `allowedQualities` (`internal/requests/service.go:384`) always gives `1080p`. It adds `2160p` when the admin setting `force_dual_quality` is on, or when the requester's playback-quality ceiling (access group or profile) allows 4K. Then `filterUnconfiguredOptionalQualities` (`service.go:2696`) drops 2160p when no connection has `is_default_4k`. A connection with none of the `is_default` / `is_default_4k` / `is_4k` keys counts as a generic router, and that router gets both tiers and decides for itself (`routerQualityConfigured`, `service.go:2707`).
4. The host calls the plugin's `Fulfill` with a `RequestDescriptor` and the tiers. Each tier is a `RequestedQuality{id:"1080p"|"2160p", is4k}`, and all eligible connections go with it. The descriptor carries `media_type`, `title`, `year`, `external_ids{tmdb,tvdb,imdb}`, `is_anime`, `seasons` and the requester's id, profile, email and username (`request_router.proto:23-45`; `internal/requests/provider.go`, `routerDescriptor`).
5. The plugin returns one `FulfillmentTarget` per tier: `quality`, `connection_id`, `external_id` (the arr movie or series id), `status` (`queued|downloading|completed|failed`) and `message`. The host stores one Target per tier, with a unique key on (request, quality) (`service.go`, `recordTargets`).
6. A reconcile task runs every 5 minutes (`internal/taskmanager/tasks/reconcile_requests.go:131`) and calls `CheckStatus` for each Target. While a plugin that declares `reports_download_progress` has a Target downloading, the host asks every minute (`request_router.proto`, `RequestRouterDescriptor`).
7. The Request completes when every Target is `completed` (`internal/requests/targets.go`, `aggregateStatus`), or when the title appears in the Silo library by any route (`completeWaitingFromLibrary`).

### How HD and 4K servers work

- There are two routing modes (`internal/requests/routing_mode.go`). **Standard** allows at most one normal server and one 4K server per media type. **Advanced** uses ordered routing rules: each `Route` has an `HD` and a `UHD` destination with per-route config overrides, and a `SkipUHD` flag. Rules match on TMDB facts captured when the Request was made: genre, keyword, original language, origin country, year, network, company, anime and content rating (`internal/requests/routing.go:38-80`, `routing_facts.go`).
- In the arr plugin each connection carries `service_kind` (radarr|sonarr), `root_folder`, `quality_profile_id`, `tags`, `is_default`, `is_4k`, `is_default_4k`, `search_on_add`, `minimum_availability`, `series_type`, `season_folder`, `monitor` and anime overrides (`silo-plugins/manifest.json`, the `silo.requests.arr` config schema). `RouteTargets` (`internal/arr/routing.go:27`) sends the `1080p` tier to the enabled `is_default` instance of that kind and the `is4k` tier to the `is_default_4k` instance. `Validate` (`internal/router/server.go:285`) allows one HD default and one 4K default per kind, and an HD default cannot be a 4K server.
- **4K is not chosen per Request by the user.** It follows from who is asking. A 4K-entitled requester's Request (or any Request, with `force_dual_quality`) goes to **both** servers at once. Everyone else gets HD only.
- **You cannot later ask for UHD of a title that is already there.** `CreateRequest` refuses a movie, or a whole series, that is already in the library with `ErrAlreadyAvailable` (`service.go:924`, `931`). It also refuses a title that has an active Request with `ErrAlreadyRequested`. Today there is no "add a UHD Version to this Title" Request in Silo. The only way to add a tier afterwards is to retry a failed Target, or the case where a Target was never created.

## 2. Exact Radarr/Sonarr endpoints the request plugin calls

From `silo-plugins-requests-arr/internal/arr/*.go`. Every call uses the SDK `httpclient`, which sends `baseURL + path` with the headers `X-Api-Key`, `Accept: application/json` and, when there is a body, `Content-Type: application/json` (`silo-plugin-sdk/pkg/pluginsdk/httpclient/httpclient.go:99-106`). A base URL with a path prefix works, because the client only trims a trailing `/`. All endpoints and query parameters below exist in the current Radarr and Sonarr OpenAPI specs (checked by script against the `develop` specs, API `info.version` 3.0.0).

### Radarr (movies)

| Purpose | Call | Fields Silo sends or reads |
| --- | --- | --- |
| Detect and test the connection | `GET /api/v3/system/status` | reads `appName` (**must be "Radarr"**, case-insensitive, or the connection is rejected) and `version` (`status.go:28`) |
| Admin form options | `GET /api/v3/rootfolder` | `path`, `freeSpace`, `totalSpace`, `accessible` |
| | `GET /api/v3/qualityprofile` | `id`, `name` |
| | `GET /api/v3/tag` | `id`, `label` |
| Already present? | `GET /api/v3/movie?tmdbId={id}` | array; matches on `id > 0 && tmdbId == id` (`radarr.go:127`) |
| Lookup before add | `GET /api/v3/movie/lookup/tmdb?tmdbId={id}` | a **single** MovieResource, not an array; non-2xx means not found (`radarr.go:190-194`) |
| Add | `POST /api/v3/movie` | the lookup result with `rootFolderPath`, `qualityProfileId`, `monitored` (default true), `minimumAvailability` (default `released`), `tags` and `addOptions{searchForMovie (default true), monitor (default "movieOnly")}` filled in; reads back `id`. On error, or an empty `id`, it looks the movie up again by `tmdbId` (`radarr.go:70-124`) |
| Status | `GET /api/v3/queue/details?movieId={id}` | array of `status`, `trackedDownloadState`, `trackedDownloadStatus`, `downloadId`, `title`, `size`, `sizeleft`, `estimatedCompletionTime`, `movieId` |
| Status when the queue is empty | `GET /api/v3/movie/{id}` | `hasFile`; true means `completed` / `imported` (`radarr.go:142-178`) |
| After a failed download | `GET /api/v3/config/downloadclient` | `autoRedownloadFailed`; if true or unreadable the Target stays queued, if false it is failed (`resources.go:154`) |

### Sonarr (series)

| Purpose | Call | Fields |
| --- | --- | --- |
| Detect and test | `GET /api/v3/system/status` | `appName` (**must be "Sonarr"**), `version` |
| Form options | `GET /api/v3/rootfolder`, `/qualityprofile`, `/tag` | as for Radarr |
| | `GET /api/v5/settings/metadata` | `preferredMetadataLanguage`; a **404 is read as Sonarr v4** and allowed (`resources.go`, `PreferredMetadataLanguage`) |
| | `GET /api/v3/language` | `id`, `name` (only called when the v5 call succeeded) |
| Already present? | `GET /api/v3/series?tvdbId={id}` | array; matches on `id`, `tvdbId` |
| Lookup | `GET /api/v3/series/lookup?term=tvdb:{id}` | array; first match on `tvdbId` |
| Add | `POST /api/v3/series` | lookup result with `rootFolderPath`, `qualityProfileId`, `seasonFolder`, `monitored`, `seriesType` (standard/daily/anime), `tags`, `language{id}` (v5), `seasons[{seasonNumber,monitored}]`, `monitorNewItems` and `addOptions{monitor, searchForMissingEpisodes, searchForCutoffUnmetEpisodes}`. A whole-series Request sends `addOptions.monitor` (default `all`). A season Request sends only the requested seasons as monitored, with `monitorNewItems:"none"` (`sonarr.go:140-230`) |
| Add seasons to an existing series | `GET` then `PUT /api/v3/series/{id}` | read-modify-write of the **whole raw object**, setting `monitored` and `seasons[].monitored` |
| | `GET /api/v3/episode?seriesId={id}` | `id`, `seasonNumber`, `monitored` |
| | `PUT /api/v3/episode/monitor` | `{episodeIds:[...], monitored:true}` |
| | `POST /api/v3/command` | `{name:"SeasonSearch", seriesId, seasonNumber}` |
| Status | `GET /api/v3/queue/details?seriesId={id}` | as for Radarr, plus `seasonNumber` |
| Status when the queue is empty | `GET /api/v3/series/{id}` | `statistics{episodeCount, episodeFileCount}` and `seasons[].statistics`. Complete when `episodeFileCount >= episodeCount > 0` |
| After a failed download | `GET /api/v3/config/downloadclient` | `autoRedownloadFailed` |

### Arr calls outside Requests

- **Autoscan** tells Silo to rescan after imports. There are two ways:
  - The built-in "Sonarr/Radarr Webhook" source takes Radarr/Sonarr Connect webhooks. It parses `eventType`, `movie.folderPath`/`path`, `movieFile(s)`, `renamedMovieFiles`, `series.path`, `episodeFile(s)`, `renamedEpisodeFiles` and `deletedFiles` (`silo-server/internal/autoscan/arrwebhook/parse.go`).
  - The `silo.autoscan.arr` polling plugin calls `GET /api/v3/history?page=&pageSize=&sortKey=date&sortDirection=descending` (`silo-plugin-autoscan-arr/internal/arr/history.go:208-214`).

  Neither is needed when Silo watches the library folders on a local disk. Real-time monitoring is on by default ([docs: Keep libraries up to date](https://siloserver.org/docs/autoscan)). The Kestrel `/data/media` layout fits that.

## 3. Plugin system and open API

- **Plugins** are separate binaries that speak gRPC through `hashicorp/go-plugin` (`silo-plugin-sdk/go.mod`). The SDK is **Apache-2.0** (`silo-plugin-sdk/LICENSE`), so a Kestrel plugin can be GPLv3 without pulling in Silo's AGPL. A plugin declares its capabilities in `manifest.json`. The capabilities are `metadata_provider`, `marker_provider`, `media_analyzer`, `image_resolver`, `scheduled_task`, `event_consumer`, `auth_provider`, `http_routes`, `request_router`, `scan_source`, `watch_sync_provider`, `network_access_provider`, `audiobook_backend` and `ebook_backend`, each `.v1` (SDK README).
- **Ways to install** ([docs: Install and maintain plugins](https://siloserver.org/docs/plugins)): from the catalog (first-party, or "approved community plugins" in `Silo-Community`), from an added **repository**, or **from a file** (uploading the binary). So a Kestrel plugin can ship from Kestrel's own releases without Silo approving it, and can be listed in the community catalog later.
- **`request_router.v1`** (`request_router.proto`) has five RPCs: `Fulfill`, `CheckStatus`, `ListConfigOptions` (fills admin form dropdowns), `TestConnection` and `Validate` (with sibling connections, for cross-connection rules). The plugin stores no credentials; each call passes `RouterConnection{id, base_url, api_key, config}`. Manifest flags:
  - `supports_seasons`
  - `reports_download_progress`, which reports progress as a phase (queued, downloading, paused, stalled, importing or import_blocked) plus bytes total, bytes left, ETA and the number of downloads
  - `wording`, the step and status labels users see
  - `api_key_optional` and `base_url_optional`

  A Target can also return its own `wording` (for example "Not out yet").
- **`RuntimeHost`** callbacks (SDK README): `PublishEvent`, `GetHostInfo`, `ListLibraries`, `CheckMediaPresence`, `ListLibraryMedia`, `ListInstalledPlugins`, `CallPluginHTTP` and `SetGlobalConfigEntry`.
- **Open API**: REST `/api/v2`, OpenAPI at `contracts/api/v2/openapi.json`, with API keys ([docs: api-keys](https://siloserver.org/docs/api-keys)). It covers Requests (`POST /api/v2/requests`, `GET /requests/mine`, `/requests/{id}`, discover and search, follows) and admin Request management (`/admin/requests`, approve, decline, retry, cancel, events, `/admin/request-integrations`, `/admin/request-routes`, `/admin/request-routing`, `/admin/request-settings`). Outbound, Silo has notification **server channels**: Discord or a generic signed webhook, fed by "best-effort request lifecycle posts" with the events `request.submitted`, `request.approved`, `request.declined` and `request.fulfilled` (`internal/notifications/server_channel_types.go`). They are notifications. They carry no tier, no Target and no status feedback, so they are no contract for fulfilling Requests. The supported way for a backend to receive and fulfil Requests is a `request_router` plugin. The other way is to poll the admin API.

## 4. What Kestrel would need

### Option A: emulate "HD Radarr" + "UHD Radarr" + Sonarr (works with the stock `silo.requests.arr`)

Kestrel serves an arr-compatible subset under per-Profile base paths, for example `/compat/radarr/hd`, `/compat/radarr/uhd`, `/compat/sonarr/hd` and `/compat/sonarr/uhd`. The admin adds one Silo connection per path: HD set as `is_default`, UHD set as `is_4k` + `is_default_4k`.

What it must implement, per section 2:

- `system/status` returning `appName` "Radarr" or "Sonarr".
- `rootfolder`, `qualityprofile` and `tag`. The profile list can be the single Profile the path stands for.
- `movie?tmdbId`, `movie/lookup/tmdb`, `POST movie` and `movie/{id}.hasFile`.
- `series?tvdbId`, `series/lookup?term=tvdb:`, `POST series` and `GET/PUT series/{id}`, including `statistics` and per-season statistics.
- `episode?seriesId`, `PUT episode/monitor`, `POST command` (`SeasonSearch`), `queue/details?movieId|seriesId` and `config/downloadclient.autoRedownloadFailed`.
- `/api/v5/settings/metadata` answering **404**, so the plugin treats it as Sonarr v4.
- API-key auth through `X-Api-Key`.

The catches:

- **Each Profile must be its own virtual instance.** The plugin checks "already present" first with `GET movie?tmdbId`. If HD and UHD were one Kestrel endpoint, the UHD submit would find the movie the HD submit just added and return it without adding anything, so the UHD Version would never be created. Each virtual instance should list only Titles that have a Version under its Profile. `hasFile`, `statistics` and the queue must be per Version too. `qualityProfileId` on POST is redundant with the path, but should be checked against it.
- The plugin sends Radarr/Sonarr vocabulary: `minimumAvailability`, `addOptions.monitor` (`movieOnly`, or Sonarr's `all|future|recent|lastSeason|firstSeason|pilot`), `seriesType`, `seasonFolder` and `monitorNewItems`. Kestrel's Series monitoring is All / Future only / None plus per-season toggles. Most Sonarr policies have no direct mapping, so Kestrel must map or reject them.
- The lookup response is posted back as the add body, so Kestrel must return a MovieResource or SeriesResource it can take back (at least `title`, `tmdbId`/`tvdbId`, `year`, `titleSlug` and Sonarr `seasons[]`). The series `PUT` round-trips the whole object.
- It is a frozen copy of someone else's API. Changes to the plugin (it is at v0.1.9 and moving) can break Kestrel without notice. Kestrel would also present itself as "Radarr" and "Sonarr" by name.
- The **requester identity is lost**: Radarr's API has no field for it. The glossary says a Request "carries who asked", so this path cannot meet that.
- It is more surface than Silo needs: about 14 endpoints, plus Radarr/Sonarr resource shapes and statistics semantics.

### Option B: a Kestrel `request_router.v1` plugin talking to Kestrel's native API

A small Go binary built on the Apache-2.0 SDK. It has one Silo connection (Kestrel base URL + API key) with no `is_default*` keys. Silo then treats it as a generic router: it sends **both** tiers whenever the requester is entitled to 4K (or `force_dual_quality` is on), and lets the plugin decide (`service.go:2707`).

- `Fulfill`: one Kestrel call, for example `POST /api/requests {tmdb|tvdb|imdb, media_type, seasons, profiles:[HD, UHD], requested_by:{silo user id, username, email}}`. The plugin maps `1080p` to the HD Profile and `2160p` to the UHD Profile (`is4k`), configurable in its config schema. It returns one Target per tier with `external_id` set to the Kestrel Title id (or Version id).
- `CheckStatus`: one Kestrel call per Request, returning each Version's state (queued, downloading or completed), progress (phase, bytes, ETA) and optional wording. It declares `supports_seasons` and `reports_download_progress`.
- `ListConfigOptions`, `TestConnection` and `Validate`: Kestrel's Profiles and the health and version endpoint.
- The Kestrel side is a small Request API in Kestrel's own words (Title, Profile, Version, Request, requester), which Kestrel's own UI can use too. Kestrel owns the contract, keeps who asked, and needs no Radarr naming or vocabulary.
- Cost: a second artifact (the plugin binary for linux/amd64, linux/arm64 and darwin/arm64), plus keeping up with the SDK's semver. Users install it from a file or a repository, or from the community catalog once approved.

### Shared constraint (both options)

Silo decides the UHD tier **at Request time, from the requester's entitlement**, and refuses Requests for titles already in its library. So "add UHD to an existing HD Title by Request" cannot be expressed through Silo today in either option. It happens only when a 4K-entitled user is the first to request the Title, and then HD and UHD arrive together. Kestrel's "HD default, UHD added per Title, usually by a Request" therefore means:

- (a) a Silo Request from a 4K-entitled user creates the Title with both Versions;
- (b) adding UHD to a Title that is already in the library is done in Kestrel's own UI;
- (c) asking Silo upstream for a "request a missing tier" feature is optional.

Silo's playback ceiling, not the requester's wish, decides who gets UHD. Admins control it with the access group's max playback quality, or with `force_dual_quality` for everyone.

## Recommendation input (not a decision)

Option B fits Kestrel's model and the "Request carries who asked" rule better. It is smaller and stable, because Kestrel owns both ends. Option A only helps if zero-install compatibility with stock Silo matters for v1. If it does, it can come later as a compatibility layer, but the per-Profile virtual-instance trick is required, and so are the Sonarr monitor-policy mappings. Either way, Kestrel does not need to emit arr webhooks for Silo, because Silo watches the shared `/data/media` folders itself.
