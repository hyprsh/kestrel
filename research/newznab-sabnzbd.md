# Newznab and SABnzbd APIs

Research for [#5](https://github.com/hyprsh/kestrel/issues/5). Question: which parts of the Newznab and SABnzbd APIs Kestrel needs, and how Radarr and Sonarr detect failed SABnzbd downloads and map finished jobs back to a grab.

Researched 2026-10-17. Sources, pinned where they are code:

- **Newznab spec:** [newznab.readthedocs.io, API](https://newznab.readthedocs.io/en/latest/misc/api.html) (cited as **NZ**).
- **NNTmux** (the maintained nZEDb successor), master `1c8c37c`: [ApiController.php][nn-api], [helpers.php][nn-err], [XML_Response.php][nn-xml], [ThrottleApiRequestsByToken.php][nn-throttle].
- **SABnzbd API docs** for 5.1, the current stable line (5.1.3, released 2026-09-08): [sabnzbd.org/wiki/configuration/5.1/api](https://sabnzbd.org/wiki/configuration/5.1/api) (cited as **SAB**).
- **SABnzbd source**, develop `8a0dfa5` (5.2.0Beta2): [api.py][sab-api], [constants.py][sab-const].
- **Radarr**, develop `df2faa6`, and **Sonarr**, develop `2b39049`. File links follow below.

Glossary terms are capitalised (Title, Movie, Series, Version, Import). "Grab" means sending one chosen release to SABnzbd. It is not in `GLOSSARY.md` yet and may deserve an entry, since the failure-handling design depends on it.

---

## 1. Newznab: the subset Kestrel needs

### 1.1 Functions

All calls are `GET {base}{apiPath}?t=<function>&apikey=…`, where `apiPath` defaults to `/api`. The response is RSS 2.0 XML with the `newznab` namespace `http://www.newznab.com/DTD/2010/feeds/attributes/`. `o=json` exists (**NZ**), but JSON shapes vary between indexers, and Radarr and Sonarr only ever request XML ([NewznabRssParser.cs][r-rss]). Kestrel should parse XML only.

| `t=` | Use in Kestrel | Parameters used |
|---|---|---|
| `caps` | Discover limits, search modes and categories when an indexer is added. Cache it (Radarr caches for 7 days, [NewznabCapabilitiesProvider.cs][r-caps]). | `apikey` (optional for caps) |
| `movie` | Movie id search, and the Movie RSS feed (no id, no `q`) | `imdbid`, `tmdbid`, `cat`, `extended=1`, `offset`, `limit`, `q` |
| `tvsearch` | Series id search (episode and season), and the Series RSS feed | `tvdbid` (plus `imdbid`, `tvmazeid`, `rid`, `tmdbid` when advertised), `season`, `ep`, `cat`, `extended=1`, `offset`, `limit`, `q` |
| `search` | Text fallback when id search is unsupported or returns nothing | `q`, `cat`, `extended=1`, `offset`, `limit` |
| `get` | Fetching the NZB. In practice the item's `<enclosure url>` or `<link>` already holds the full `t=get&id=…&apikey=…` URL, so Kestrel downloads that URL as is. | — |

Kestrel does not need `details`, `getnfo`, `register`, cart functions, comments or `nzbadd`. Per **NZ**, every conforming server must support `caps` and `search`. The other functions are optional, and calling an unsupported one returns error `203 Function not available`.

### 1.2 `caps`: what to read

Example from **NZ**:

```xml
<caps>
  <limits max="100" default="50"/>
  <retention days="400"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="yes" supportedParams="q,rid,tvdbid,imdbid,tvmazeid,season,ep"/>
    <movie-search available="yes" supportedParams="q,imdbid,genre"/>
  </searching>
  <categories>
    <category id="2000" name="Movies"><subcat id="2040" name="HD"/>…</category>
  </categories>
</caps>
```

Radarr and Sonarr read these parts ([NewznabCapabilitiesProvider.cs][r-caps], [NewznabCapabilities.cs][r-capsmodel]):

- **`limits@default` and `limits@max`** give the page size. Radarr clamps the default page size between `min(100, max)` and `max` ([Newznab.cs][r-nz] `GetProviderPageSize`). These limits cover results per page only. API and download quotas are separate (§1.5).
- **`searching/*@available` and `@supportedParams`** decide which id parameters to send. If the attribute is missing, the defaults are `q` for search and `q,imdbid,imdbtitle,imdbyear` for movie search. Some caps responses also carry a `searchEngine` attribute (`raw` or `sphinx`), which changes how `q` titles are cleaned ([NewznabRequestGenerator.cs][r-req]). If `supportedParams` is present on `movie-search`, Radarr assumes the indexer accepts several ids in one request ("aggregate id search"). Sonarr does the same for `tv-search`.
- **`categories`** fill the category picker in the indexer settings.

If `caps` fails, Radarr logs it and uses the defaults until restart, rather than disabling the indexer.

### 1.3 Search requests, as Radarr and Sonarr build them

Every request carries `cat=<comma list>&extended=1&offset=<n>&limit=<pageSize>`. Paging goes up to 30 pages and stops at the first short page or after 1000 results ([HttpIndexerBase.cs][r-http], `MaxNumResultsPerQuery = 1000`, `IsFullPage`).

- **Movie** ([Radarr NewznabRequestGenerator.cs][r-req]): `t=movie&tmdbid=<id>&imdbid=<digits>`. Both ids go in one request when aggregate search is supported. Otherwise Radarr prefers `tmdbid` and falls back to `imdbid`. Radarr strips the `tt` prefix from imdbid. NNTmux accepts the id either way, because it strips `tt` itself ([ApiController.php][nn-api] l.428). A second tier runs only if the first tier returned nothing: `t=search&q=<title> <year>`.
- **Series episode** ([Sonarr NewznabRequestGenerator.cs][s-req]): `t=tvsearch&tvdbid=<id>&season=<n>&ep=<n>`. With aggregate search, all known ids are combined (`tvdbid`, `imdbid`, `rid`, `tvmazeid`, `tmdbid`). Otherwise the first supported id wins, in the order tvdbid > imdbid > rid > tvmazeid > tmdbid. Season 0 is sent as `season=00`. A title tier (`q=<title>`) follows if ids find nothing. Episode search requires `season` and `ep` in `supportedParams`.
- **Season (pack) search**: the same request without `ep`. Requires `season`.
- **Daily shows** (Sonarr): `season=<yyyy>&ep=<MM>/<dd>`. Kestrel can skip this in v1 unless daily shows matter.
- NNTmux's `tvsearch` accepts `q, vid, tvdbid, traktid, rid, tvmazeid, imdbid, tmdbid, season, ep`. Its `movie` accepts `q, imdbid, tmdbid, traktid` ([ApiController.php][nn-api] l.279, l.381). So tmdbid on movies and tvdbid on Series are widely supported in practice, although the original newznab spec only lists `imdbid` for movie search and `rid`/`tvdbid` for TV.

**Categories** (standard ids, **NZ**): Movies 2000, with SD 2030, HD 2040, UHD 2045, BluRay 2050, 3D 2060 and Foreign 2010. TV 5000, with SD 5030, HD 5040, UHD 5045, Foreign 5020 and Anime 5070. Radarr's default movie categories are `2000,2010,2020,2030,2040,2045,2050,2060` ([NewznabSettings.cs][r-nzsettings]). Indexers can add custom categories at 100000 and above, so the category list must come from `caps`, not a hard-coded list.

### 1.4 RSS sync

There is no separate RSS endpoint. "RSS" is the same `t=movie` or `t=tvsearch` call with no id and no `q`, only `cat`, paged newest-first ([Radarr][r-req] `GetRecentRequests`, [Sonarr][s-req]). Radarr falls back to `t=search` if movie search is unavailable. Paging stops once a page's oldest item is older than the last release seen in the previous sync, or contains the same download URL. Radarr stores that last release per indexer. If it pages through 1000 results older than 24 h without reaching it, it logs an "RSS sync gap" warning ([HttpIndexerBase.cs][r-http] l.130–190). The default interval is 30 min in Radarr and 15 min in Sonarr, with a minimum of 10 min ([TaskManager.cs][r-task], [Sonarr ConfigService.cs][s-config]). The newest-first paging relies on the `<pubDate>` and `usenetdate` order.

Kestrel needs one RSS feed per indexer per kind (Movie and Series categories), or one combined call with both category sets. Each item is then matched to Titles by the ids in its attributes, falling back to the parsed title.

### 1.5 Item fields and attributes

Standard RSS elements per item (**NZ**, [XML_Response.php][nn-xml]): `title`, `guid`, `link` (the NZB URL), `comments` (the details page with `#comments`), `pubDate` (RFC 822, the indexer's post date), `category`, `description`, `enclosure@url/@length/@type` (type `application/x-nzb`). The response also contains `<newznab:response offset total>`.

`newznab:attr` name/value pairs. Only `size` and `category` are guaranteed. `extended=1` asks for all of them (**NZ**). Radarr and Sonarr read these ([Radarr NewznabRssParser.cs][r-rss], [Sonarr NewznabRssParser.cs][s-rss]):

| Attribute | Use | Read by |
|---|---|---|
| `size` | bytes. Falls back to `enclosure@length`. | both |
| `usenetdate` | the post date on usenet, which the age calculation and retention checks use. Falls back to `pubDate`. | both |
| `imdb` (digits), `tmdbid` | match an item to a Movie | Radarr |
| `tvdbid`, `rageid` (and `imdb`) | match an item to a Series | Sonarr |
| `language` (repeatable, comma list) | language hints. Useful for the German DL preference, but titles are the more reliable signal. | both |
| `subs` | flags subtitles (Sonarr) | Sonarr |
| `prematch` / `haspretime` = 1 | scene flag | both |
| `nuked` = 1 | nuked flag | both |
| `category` | indexer category id(s) | — |

Worth reading that the *arrs ignore: `grabs` (a popularity tie-breaker, and Prowlarr shows it), `files`, `password`, `season`/`episode`, `tvmazeid`, `group`, `poster`. `guid` is a stable id per indexer, useful for dedupe and the blocklist.

**`extended=1` is required in practice.** NNTmux returns only `category`, `size` (and `coverurl`) without it. `files`, `grabs`, `comments`, `password`, `usenetdate`, `group`, `imdb`, `prematch` and the TV ids (`season`, `episode`, `tvdbid`, `tvmazeid`, `tmdbid`, `rageid`/`tvrageid`, `imdbid`) appear only with `extended=1` ([ReleaseItemPayloadBuilder.php][nn-payload]). The TV id attributes appear only on releases linked to a video record, and NNTmux sends no `tmdbid` attribute for movies, only `imdb`.

**`password`** is not standardised. NNTmux sends its raw `passwordstatus`: 0 None, 1 Possibly passworded, 2 Probably not viable, 10 Passworded ([XML_Response.php][nn-xml] l.689). Kestrel can use any value other than 0 as a reject or penalty signal. It should not assume one exact meaning per number across indexers.

### 1.6 Errors and limits

- Errors come back as `<error code="…" description="…"/>`, usually with **HTTP 200** (**NZ**). Codes: 100–107 account or credentials, 200 missing parameter, 201 incorrect parameter, 202 no such function, 203 function not available, 300 no such item, 900 unknown, 910 API disabled.
- **Quota codes** come from nZEDb/NNTmux, not the original spec: **500 "Request limit reached"** and **501 "Download limit reached"**. NNTmux sends both with **HTTP 429** ([helpers.php][nn-err] l.1047). Its per-minute throttle middleware also sends `Retry-After` and `X-RateLimit-Limit/Remaining` ([ThrottleApiRequestsByToken.php][nn-throttle]). NNTmux appends counts to the message, e.g. `Request limit reached (100/100)`.
- **Quota reporting**: search responses may include `<newznab:apilimits apicurrent apimax grabcurrent grabmax apioldesttime graboldesttime/>` (**NZ**, [XML_Response.php][nn-xml] l.213). Not every indexer sends it. NNTmux counts usage over a rolling window from the oldest hit (`apioldesttime`).
- **What Radarr and Sonarr do** ([NewznabRssParser.cs][r-rss] `CheckError`, [HttpIndexerBase.cs][r-http], [UsenetClientBase.cs][r-usenet]):
  - Codes 100–199 raise `ApiKeyException`, which counts as an indexer failure.
  - A description exactly equal to `"Request limit reached"`, or an HTTP 429, disables the indexer for the `Retry-After` value when the header is present, otherwise for 1 hour. Because of the exact-string check, NNTmux's suffixed message is caught through the HTTP 429 path, not the description check.
  - Any other failure disables the indexer with escalating backoff: 0, 1, 5, 15, 30 min, then 1, 3, 6, 12 and 24 h ([EscalationBackOff.cs][r-backoff]). Each indexer gets a 2 s minimum gap between requests (`RateLimit`).
  - On NZB fetch, HTTP 404/410 means the release is unavailable and HTTP 429 means the grab limit was reached ("API Grab Limit reached"). The *arrs do not parse `apilimits` at all.
- **Recommendation**: treat HTTP 429 and codes 500/501 as quota errors and honour `Retry-After`. Read `apilimits` when present, both to show quota in the UI and to stop searching before hitting the wall. Keep separate backoff for search (500) and grabs (501), so that running out of grabs does not block RSS.

---

## 2. SABnzbd: the subset Kestrel needs

All calls are `GET|POST {base}/api?mode=<mode>&apikey=<key>&output=json` (**SAB**). The full API key is required for everything except `version` and `auth`. The NZB key can only add jobs, so Kestrel needs the full API key. Errors are returned as `{"status": false, "error": "…"}`, or as plain text such as `error: API Key Incorrect` / `error: API Key Required`, which Radarr detects as a string prefix ([SabnzbdProxy.cs][r-sabproxy] `CheckForError`).

### 2.1 Calls

| Call | Use | Notes |
|---|---|---|
| `mode=version` | connection test, feature gating | Radarr requires ≥ 0.7. SABnzbd 4.x and 5.x are current. |
| `mode=get_config` | auth test. Read `misc.complete_dir`, `categories[].name/dir`, `misc.history_retention_option/number`, `misc.pre_check`, `sorters[]` (4.1+) and the legacy `enable_tv_sorting`/`enable_movie_sorting` flags | Radarr warns if the category dir ends in `*` (job folders disabled) or if SAB sorting is active for the category ([Sabnzbd.cs][r-sab] `TestCategory`). Kestrel should run the same checks, because it does the renaming itself. |
| `mode=fullstatus&skip_dashboard=1` | `completedir` when `complete_dir` is relative | `skip_dashboard` avoids a slow public-IP lookup (**SAB**). |
| `mode=addfile` (POST multipart) | **Grab**: upload the NZB bytes | File field `name` (or `nzbfile`), plus `cat`, `priority`, and optionally `nzbname`, `pp`, `password`. Response `{"status": true, "nzo_ids": ["SABnzbd_nzo_…"]}`. |
| `mode=addurl&name=<url>` | alternative Grab where SAB fetches the URL | Same parameters and response. Jobs show status `Grabbing` while SAB fetches. **The *arrs don't use it** (see §2.2). |
| `mode=queue&category=<cat>&start=0&limit=0` | poll active jobs | Also supports `nzo_ids=` (comma list), `status`, `search`. |
| `mode=history&category=<cat>&start=0&limit=<n>` | poll post-processing and finished jobs | Also supports `nzo_ids=`, `failed_only=1`, `status=`, and `last_history_update=<n>`. With `last_history_update`, SAB returns `history: false` if nothing changed ([api.py][sab-api] `_api_history_default`). |
| `mode=queue&name=delete&value=<nzo_id>&del_files=1` | remove a queued job (user removal, or a failed-pending job) | |
| `mode=history&name=delete&value=<nzo_id>&del_files=<0/1>&archive=<0/1>` | remove a finished job after Import, or a failed job | By default deleted items move to the Archive. `archive=0` deletes them for good. Radarr archives completed items and permanently deletes failed ones (`archive = status==Failed ? 0 : 1`). `del_files=1` is needed to remove a failed job's files. |
| `mode=retry&value=<nzo_id>` | retry a failed job in SAB | Radarr has a proxy method for it but the client never calls it. Kestrel's retry means grabbing the next-best release, not retrying the same job. |

**Priority** values: `-100` category default, `-2` Paused, `-1` Low, `0` Normal, `1` High, `2` Force. **pp** values: `-1` default, `0` none, `1` +Repair, `2` +Unpack, `3` +Delete (**SAB**). Radarr and Sonarr only send `cat` and `priority`, never `pp`, `script` or `nzbname`. They have separate "recent" and "older" priorities, both defaulting to `-100` ([SabnzbdSettings.cs][r-sabsettings]). Their default category is `movies` for Radarr and `tv` for Sonarr.

### 2.2 addfile versus addurl

Radarr and Sonarr download the NZB themselves and hand SAB the bytes ([UsenetClientBase.cs][r-usenet]). This has several effects:

1. The indexer API key never goes into SAB.
2. Indexer errors (404/410 "no longer exists", 429 grab limit) surface at grab time and are attributed to the indexer. With `addurl` they would show up later as a failed SAB job.
3. The NZB can be validated first ([NzbValidationService.cs][r-nzbval]).
4. The `nzo_id` comes back at once, so the grab record has its download id immediately. The filename is the cleaned release title plus `.nzb`, which SAB uses as the job name.

Kestrel should do the same.

### 2.3 Fields to read

- **Queue slot** ([SabnzbdQueueItem.cs][r-sabq], **SAB**): `nzo_id`, `filename` (job name, may carry the prefix `ENCRYPTED / `), `cat`, `status`, `priority`, `mb`, `mbleft`, `percentage`, `timeleft` (`H:MM:SS`), `labels` (`DUPLICATE`, `ENCRYPTED`, `PROPAGATING x min`, `TOO LARGE`). Top level: `paused`.
- **History slot** ([SabnzbdHistoryItem.cs][r-sabh], **SAB**, [api.py][sab-api] `build_history`): `nzo_id`, `name`, `nzb_name`, `category`, `status`, `fail_message`, `storage` (the final folder, the Import source), `bytes`, `download_time`, `completed` (unix time), `stage_log` (per-stage action lines, useful as failure detail), `path` (the incomplete folder), `retry`, `duplicate_key`.

### 2.4 Statuses and when post-processing is done

SABnzbd statuses ([constants.py][sab-const] `class Status`), by where they appear:

- Queue: `Grabbing`, `Queued`, `Paused`, `Checking` (pre-check), `Downloading`, `Fetching` (extra par2), `Propagating` (delayed), `Deleted`.
- History, while post-processing: `Queued` (waiting for post-processing), `QuickCheck`, `Verifying`, `Repairing`, `Extracting`, `Moving`, `Running` (user script).
- History, final: **`Completed`** and **`Failed`**.

A job leaves the queue for the history when its download ends, and post-processing then runs inside the history. **Post-processing is done only when a history slot has `status == "Completed"`** (and `storage` is set) or `status == "Failed"`. Radarr maps every other history status to "Downloading" ([Sabnzbd.cs][r-sab] `GetHistory`, comment "Verifying/Moving etc").

Radarr's mapping:

- Queue `Paused`, or SAB globally paused and the job not `Force`: Paused.
- Queue `Queued`, `Grabbing` or `Propagating`: Queued.
- Every other queue status: Downloading.
- History `Failed`: Failed. The one exception is the `fail_message` "Unpacking failed, write error or disk is full?", which becomes a Warning, because the job is fine and SAB is the problem.
- History `Completed`: Completed. The output path is `storage`, walked up to the folder named after the job if needed.
- `Deleted`: skipped in both lists.
- A queue job whose title starts `ENCRYPTED /` gets `IsEncrypted`, and is treated as failed (§3.3).

SAB `fail_message` values seen in source include "Aborted, encryption detected", "Aborted, unwanted extension detected", "Duplicate NZB", "Repairing failed, …", "Unpacking failed, …", "Failed to move files", "Post-processing was aborted" and script output lines ([sabnzbd/ source][sab-tree]). Kestrel should store the message verbatim as the failure reason.

### 2.5 History retention

If SAB drops finished jobs from its history before Kestrel Imports them, Kestrel loses track of them. Radarr reads `history_retention_option`/`history_retention_number` (4.3+) and flags "removes completed downloads" for `number-*` and `all-*` options, and for `days-*` options under 14 days ([Sabnzbd.cs][r-sab] `RemovesCompletedDownloads`). Kestrel should warn on the same settings in its SAB setup test.

---

## 3. How Radarr and Sonarr track grabs and failures

### 3.1 Mapping a SAB job back to a grab

1. **At grab time** ([DownloadService.cs][r-dlsvc]), `addfile` returns `nzo_ids[0]`. That id becomes the `DownloadId` in a `Grabbed` history row for the Movie, or for each episode in Sonarr. The row also stores the indexer, release title, size, publish date, protocol, indexer flags and release source (RSS, automatic search or interactive search), and the download client id.
2. **Polling** ([DownloadMonitoringService.cs][r-monitor]) runs `RefreshMonitoredDownloads` every minute by default (`CheckForFinishedDownloadInterval = 1`, minimum 1), and also 5 s after each grab or Import (debounced). Each poll reads `GetItems()` = queue + history (history limited to `DownloadClientHistoryLimit`, default **60**), filtered to **only the configured category** ([Sabnzbd.cs][r-sab] `GetItems`).
3. **Matching** ([TrackedDownloadService.cs][r-tracked] `TrackDownload`) uses the **`DownloadId` (nzo_id) only**. The service looks up the latest download-history event for that id. `Imported`, `Failed` and `Ignored` set the tracked state, so a job is never processed twice. It finds the `Grabbed` row to recover the Title, indexer and flags. Title parsing is only a fallback, for jobs added outside the *arr or whose grab history is missing.
4. Tracked downloads are held in an in-memory cache keyed by DownloadId. Ones in a final state (`Imported`, `Failed`, `Ignored`) drop out of the queue view.

For Kestrel, the grab record (one per Version Grab, or per episode set) should store the `nzo_id`, and the polling loop should join on it. A dedicated SAB category per kind, as the *arrs use, keeps jobs Kestrel did not add out of view. Using one category for both kinds works too, as long as the join is on `nzo_id`.

### 3.2 Completed jobs

[CompletedDownloadService.cs][r-completed] `Check` runs only when the history status is `Completed`. If there is no Grabbed row and no category, it warns and skips. If a Grabbed row exists but the parsed title doesn't match its Movie, it uses the Movie from the Grabbed row. It blocks the Import only when the release had been matched by id outside interactive search ("Manual Import required"). Otherwise it marks the job `ImportPending` and Imports from `storage`. After the Import it removes the job from SAB history if `RemoveCompletedDownloads` is on (default **true**, [DownloadClientDefinition.cs][r-dldef]).

### 3.3 Failed jobs

[FailedDownloadService.cs][r-failed]:

1. **`Check`** runs while the tracked state is `Downloading` or `ImportBlocked`. If `DownloadItem.Status == Failed` (a history `Failed`) **or** `IsEncrypted` (the `ENCRYPTED /` queue prefix), and a `Grabbed` history row exists for the DownloadId, the state becomes **`FailedPending`**. Without a Grabbed row it only warns ("…wasn't grabbed by Radarr, skipping").
2. **`ProcessFailed`** sets the state to `Failed` and publishes a `DownloadFailedEvent`. The message is SAB's `fail_message`, or "Encrypted download detected", or "Failed download detected". Three handlers react:
   - **Blocklist** ([BlocklistService.cs][r-blocklist]): inserts the Movie id, source title, quality, languages, indexer, publish date, size, protocol, message and indexer flags. A later usenet release counts as blocklisted when it has the same Movie and the same title, and either the same publish date, or a different indexer with publish date within ±2 min and size within ±2 MB ([ReleaseComparer.cs][r-cmp]). This catches the same post re-listed on another indexer.
   - **Redownload** ([RedownloadFailedDownloadService.cs][r-redl]): if `AutoRedownloadFailed` is on (default **true**), and the grab came from interactive search only when `AutoRedownloadFailedFromInteractiveSearch` is on (default true), it queues a new search. Radarr runs a Movie search. Sonarr runs an episode search for one episode, a **season search when the failed release covered the whole season**, and otherwise an episode search for the listed episodes ([Sonarr RedownloadFailedDownloadService.cs][s-redl]). The blocklist then filters out the failed release, so the search picks the next-best one.
   - **Cleanup** ([DownloadEventHub.cs][r-hub]): if `RemoveFailedDownloads` is on (default **true**), the job is removed from SAB with `del_files=1`. History items are deleted with `archive=0`.
3. **Manual "mark as failed"** goes through the same path (`MarkAsFailed`), keyed by DownloadId, with an option to skip the redownload.

The *arrs do not judge failure themselves. **Failure is whatever SABnzbd reports as `Failed`, plus encrypted jobs.** Import-time problems such as wrong content or a missing video file become `ImportBlocked` or warnings, not failures, unless the user marks the job failed.

---

## 4. Recommendations for the Kestrel spec

1. **Newznab client:**
   - Calls: `caps` (cached, refreshed when the indexer is saved and weekly), `movie` (tmdbid+imdbid), `tvsearch` (tvdbid first, plus season/ep), `search` (text fallback), and RSS as id-less `movie`/`tvsearch` with `cat`. Always send `extended=1`.
   - Parse `size`, `usenetdate`, `guid`, ids (`imdb`, `tmdbid`, `tvdbid`, `tvmazeid`), `season`/`episode`, `language`, `password`, `grabs`, `nuked`.
   - Paging uses caps `limits` and stops at the last-seen release.
2. **Limits:**
   - Treat HTTP 429, codes 500 and 501, and code 100–199 auth errors as distinct indexer states.
   - Honour `Retry-After`, otherwise back off for 1 h on quota errors, with escalating backoff for other failures.
   - Read `apilimits` when present, and keep search and grab quotas apart.
3. **SABnzbd client:**
   - Setup test: `version`, then `get_config` (auth, category exists, job folders enabled, no sorting on the category, history retention), then `fullstatus` for the complete dir.
   - Grab: Kestrel fetches the NZB, then `addfile` with `cat` and `priority`, and stores `nzo_id`.
   - Poll `queue` and `history` (filtered by category, optionally `nzo_ids`, and `last_history_update` to make idle polls cheap) every minute, and right after a grab.
   - Import only from history `Completed` + `storage`. Fail on history `Failed`, keeping `fail_message`, and on the `ENCRYPTED` label or prefix. Treat "disk is full?" as a warning.
   - Clean up with `history delete` / `queue delete` and `del_files=1`.
4. **Failed-download handling:** key everything on `nzo_id`. On failure, blocklist the release (title + indexer + publish date + size, as the *arrs do, plus the indexer `guid`, which Kestrel has). Then re-search the same Version, and the same season-pack scope for Series. That gives "automatic retry of the next-best release" from the map.

[nn-api]: https://github.com/NNTmux/newznab-tmux/blob/1c8c37c4926f4aaed7d8d7ac90366237d22390ac/app/Http/Controllers/Api/ApiController.php
[nn-err]: https://github.com/NNTmux/newznab-tmux/blob/1c8c37c4926f4aaed7d8d7ac90366237d22390ac/app/Extensions/helper/helpers.php
[nn-xml]: https://github.com/NNTmux/newznab-tmux/blob/1c8c37c4926f4aaed7d8d7ac90366237d22390ac/app/Http/Controllers/Api/XML_Response.php
[nn-payload]: https://github.com/NNTmux/newznab-tmux/blob/1c8c37c4926f4aaed7d8d7ac90366237d22390ac/app/Services/Api/V1/ReleaseItemPayloadBuilder.php
[r-nzsettings]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/NewznabSettings.cs
[nn-throttle]: https://github.com/NNTmux/newznab-tmux/blob/1c8c37c4926f4aaed7d8d7ac90366237d22390ac/app/Http/Middleware/ThrottleApiRequestsByToken.php
[sab-api]: https://github.com/sabnzbd/sabnzbd/blob/8a0dfa50e602a3bb99135f9177af729d4b375d70/sabnzbd/api.py
[sab-const]: https://github.com/sabnzbd/sabnzbd/blob/8a0dfa50e602a3bb99135f9177af729d4b375d70/sabnzbd/constants.py
[sab-tree]: https://github.com/sabnzbd/sabnzbd/tree/8a0dfa50e602a3bb99135f9177af729d4b375d70/sabnzbd
[r-rss]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/NewznabRssParser.cs
[r-caps]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/NewznabCapabilitiesProvider.cs
[r-capsmodel]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/NewznabCapabilities.cs
[r-nz]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/Newznab.cs
[r-req]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs
[r-http]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Indexers/HttpIndexerBase.cs
[r-task]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Jobs/TaskManager.cs
[r-backoff]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/ThingiProvider/Status/EscalationBackOff.cs
[r-usenet]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/UsenetClientBase.cs
[r-nzbval]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/NzbValidationService.cs
[r-sab]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/Clients/Sabnzbd/Sabnzbd.cs
[r-sabproxy]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/Clients/Sabnzbd/SabnzbdProxy.cs
[r-sabsettings]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/Clients/Sabnzbd/SabnzbdSettings.cs
[r-sabq]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/Clients/Sabnzbd/SabnzbdQueueItem.cs
[r-sabh]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/Clients/Sabnzbd/SabnzbdHistoryItem.cs
[r-dlsvc]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/DownloadService.cs
[r-monitor]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/TrackedDownloads/DownloadMonitoringService.cs
[r-tracked]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/TrackedDownloads/TrackedDownloadService.cs
[r-completed]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/CompletedDownloadService.cs
[r-failed]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/FailedDownloadService.cs
[r-blocklist]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Blocklisting/BlocklistService.cs
[r-cmp]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Parser/ReleaseComparer.cs
[r-redl]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/RedownloadFailedDownloadService.cs
[r-hub]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/DownloadEventHub.cs
[r-dldef]: https://github.com/Radarr/Radarr/blob/df2faa64c75e6081556d11232dc46523e7264ea1/src/NzbDrone.Core/Download/DownloadClientDefinition.cs
[s-req]: https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs
[s-rss]: https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/NzbDrone.Core/Indexers/Newznab/NewznabRssParser.cs
[s-config]: https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/NzbDrone.Core/Configuration/ConfigService.cs
[s-redl]: https://github.com/Sonarr/Sonarr/blob/2b39049ee6e16e1b326792009ea4b985e29adf48/src/NzbDrone.Core/Download/RedownloadFailedDownloadService.cs
