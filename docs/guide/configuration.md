# Configuration

Kestrel has two kinds of settings:

- **Bootstrap settings** are environment variables. They say where Kestrel listens and keeps its files. [Environment variables](#environment-variables) lists them.
- **Everything else** lives in the database and is set in the UI, under Settings.

If you want Kestrel set up the same way every time, a [Config File](#the-config-file) declares the account, Profiles, download client, indexers and more. Whatever it declares, the UI shows read-only ([ADR 0014](../adr/0014-config-file-declares-sections.md)).

New here? [Getting started](getting-started.md) walks through the setup in the UI.

## Environment variables

| Variable               | Default   | What it does                                                                       |
| ---------------------- | --------- | ---------------------------------------------------------------------------------- |
| `PUID` / `PGID`        | `1000`    | The user and group Kestrel runs as. [Notes](#puid-and-pgid).                       |
| `UMASK`                | `002`     | The permission mask for files Kestrel creates.                                     |
| `TZ`                   | `UTC`     | Your time zone, for log timestamps and what counts as "today".                     |
| `KESTREL_PORT`         | `7676`    | The port Kestrel listens on.                                                       |
| `KESTREL_BASE_URL`     | empty     | A path prefix such as `/kestrel`, for a reverse proxy. [Notes](#kestrel_base_url). |
| `KESTREL_LOG_LEVEL`    | `info`    | `debug`, `info`, `warn` or `error`. Logs go to stdout as text.                     |
| `KESTREL_CONFIG_DIR`   | `/config` | Holds the database, its backups and the poster cache.                              |
| `KESTREL_DATA_DIR`     | `/data`   | Prefills the root folders, and is the mount the disk-space checks watch.           |
| `KESTREL_TMDB_API_KEY` | empty     | Your own TMDB key. [Notes](#provider-keys).                                        |
| `KESTREL_TVDB_API_KEY` | empty     | Your own TheTVDB key. [Notes](#provider-keys).                                     |
| `KESTREL_API_KEY`      | empty     | A fixed API key for scripts. [Notes](#kestrel_api_key).                            |
| `KESTREL_CONFIG_FILE`  | empty     | The path of a [Config File](#the-config-file). Unset, everything is set in the UI. |

### PUID and PGID

The container starts as root, takes ownership of `/config` (never `/data`) and then drops to `PUID` and `PGID`. Give Kestrel and SABnzbd the same two numbers, so each can read what the other writes. If you start the container as a non-root user with compose's `user:`, Kestrel skips the ownership step. [Troubleshooting](troubleshooting.md#permission-denied-or-a-folder-is-not-writable) covers permission errors.

### KESTREL_BASE_URL

The prefix goes in front of every route, including `/ping` and the API. With `KESTREL_BASE_URL=/kestrel`, Kestrel answers at `http://host:7676/kestrel/`. The image's health check calls the unauthenticated `GET {base}/ping`.

### Provider keys

Kestrel looks up Titles at [TMDB](https://www.themoviedb.org/settings/api) (Movies) and TheTVDB (Series). Release builds carry the project's own keys, so you don't need to do anything. To use your own, set the variables above or enter them in Settings > Provider keys. The order, highest first, is a key saved in the UI, then the variable, then the embedded key.

### KESTREL_API_KEY

By default you generate the API key in Settings > Security. Set `KESTREL_API_KEY` if a script wires Kestrel up and needs a key it knows in advance.

- It must look like a generated key: `kst_` followed by at least 32 characters from `A-Z` and `2-7`. Anything else stops startup. This makes one:

  ```sh
  echo kst_$(LC_ALL=C tr -dc A-Z2-7 </dev/urandom | head -c 52)
  ```

- While it is set, it replaces the key from Settings > Security, which is deleted, and you can't rotate the key in the UI.
- Remove the variable and there is no key until you generate one in the UI.

### Your files in /config

`/config` holds `kestrel.db` (the SQLite database), `backups/` and `cache/posters/`.

Before each schema migration of an existing database, Kestrel copies it to `backups/kestrel-<schema>-<timestamp>.db` and keeps the newest five. Kestrel never downgrades. If the database is newer than the binary, Kestrel refuses to start and names the backup to restore.

### Updates

Once a day, unless you switch off Settings > Updates > "Check GitHub for updates" (or `check_github_updates: false` in the Config File), Kestrel asks GitHub, without signing in, for the latest release and the published security advisories of `hyprsh/kestrel`. A newer release shows in Health and in About. An advisory that covers the version you run raises a "Security fix available" warning in Needs attention.

## The Config File

A Config File is for a deployment that wants Kestrel set up the same way every time, such as a homelab you rebuild from Git. `KESTREL_CONFIG_FILE` names a YAML file that declares sections of the settings.

On every start, after the database opens and before Kestrel serves anything, Kestrel checks the whole file with the rules the API uses. Then it brings each declared section to the file's state, writing only what differs. A file that fails a check stops startup before anything is written. The error names the file, the field and, where it can, the line. It never contains a secret.

### An example

This file declares every section. Every section is optional: leave one out and it stays in the UI.

```yaml kestrel.yaml
# Every section is optional: leave one out and it stays in the UI.
account:
  username: admin
  password_env: KESTREL_ADMIN_PASSWORD # a secret is named by its environment variable, never written here

language_region:
  primary_language: de # en, de or fr
  release_date_country: DE

root_folders: # the first of each list is the default
  movies: [/data/media/movies, /data/media/movies-kids]
  series: [/data/media/tv]

profiles: # all six or none, each with all four fields
  hd-primary:
    {
      enabled: true,
      original_language: accept,
      default_movies: true,
      default_series: true,
    }
  hd-original:
    {
      enabled: true,
      original_language: reject,
      default_movies: false,
      default_series: false,
    }
  any-primary:
    {
      enabled: false,
      original_language: reject,
      default_movies: false,
      default_series: false,
    }
  any-original:
    {
      enabled: false,
      original_language: reject,
      default_movies: false,
      default_series: false,
    }
  4k-primary:
    {
      enabled: true,
      original_language: accept,
      default_movies: false,
      default_series: false,
    }
  4k-original:
    {
      enabled: false,
      original_language: reject,
      default_movies: false,
      default_series: false,
    }

plugin_instances: # known by name
  - name: SABnzbd
    plugin_id: sabnzbd
    enabled: true # optional: leave it out and the UI switches the instance on and off
    config:
      url: http://sabnzbd:8080
      api_key_env: SABNZBD_API_KEY
      movie_category: movies
      tv_category: tv
  - name: Indexer
    plugin_id: newznab
    priority: 0 # lower wins a tie between otherwise equal Releases
    config:
      url: https://indexer.example
      api_key_env: INDEXER_API_KEY
      api_requests_per_day: 100
  - name: Jellyfin
    plugin_id: jellyfin
    enabled: true
    config:
      url: http://jellyfin:8096
      api_key_env: JELLYFIN_API_KEY
  - name: Plex
    plugin_id: plex
    config:
      url: http://plex:32400
      token_env: PLEX_TOKEN
  - name: Silo
    plugin_id: silo
    config:
      url: http://silo:8090
      api_key_env: SILO_API_KEY

reverse_proxy: # all three fields, as in Settings > Reverse proxy
  enabled: false
  trusted_proxies: [172.16.0.0/12]
  header: Remote-User

plex_sign_in: # Requesters sign in with Plex; see "Requesters (Plex sign-in)"
  enabled: true
  instance: Plex # the name of a plex plugin instance, which holds the server and its owner's token
  users: [anna, ben] # optional: only these Plex users may request; leave it out or empty for everyone with access
  user_root_folders: # optional: where a user's Requests for new Titles go, instead of the first Root folder
    anna: { movies: /data/media/movies-kids }
    ben: { series: /data/media/tv }
  watchlist: true # optional, off until set: Requests from Plex Watchlists (ADR 0019)
  watch_ahead: true # optional, off until set: a Requester's Series Request starts with season 1
  labels: true # optional, off until set: Requested labels and a collection in Plex
  poster_badge: true # optional, off until set: a "Requested" badge on posters in Plex
  poster_badge_days: 30 # optional: how long the badge stays, at least 1; 30 when left out

silo: # Watch-ahead for Silo; see "Watch-ahead for Silo"
  watch_ahead: true # optional, off until set: the default for a Silo Series Request that names no seasons
  instance: Silo # the name of a silo plugin instance, whose playback history Watch-ahead reads; needed once watch_ahead is true

display: # optional; each key you name is read-only in Settings > Display
  season_order: newest_first # oldest_first (default) or newest_first; Specials come last either way
  seasons_open: latest_and_wanted # accepted and ignored: the Title page now has a season menu
  manual_search_sort: best_first # best_first (default), or <column>_asc / <column>_desc
  upcoming_filters:
    kind: all # all (default), movie or series
    wanted_only: false
    hide_imported: false

check_github_updates: true
```

Add it to the `kestrel` service in your `compose.yaml`, and keep the secrets in a `.env` file next to it:

```yaml
services:
  kestrel:
    environment:
      - KESTREL_CONFIG_FILE=/kestrel.yaml
      - KESTREL_ADMIN_PASSWORD=${KESTREL_ADMIN_PASSWORD}
      - SABNZBD_API_KEY=${SABNZBD_API_KEY}
      - INDEXER_API_KEY=${INDEXER_API_KEY}
      - JELLYFIN_API_KEY=${JELLYFIN_API_KEY}
      - PLEX_TOKEN=${PLEX_TOKEN}
      - SILO_API_KEY=${SILO_API_KEY}
    volumes:
      - ./kestrel.yaml:/kestrel.yaml:ro
```

Mount the file outside `/config`. The entrypoint takes ownership of `/config`, which fails on a read-only mount. The file must be readable by `PUID`.

With every section declared, setup is complete at startup and the first page is the login. Setup completes as soon as nothing is left to do, from the file or from the UI. That takes an account, the language, an enabled download client, an enabled indexer and the root folders.

### How it behaves

- **Every section is optional.** A section the file leaves out stays in the UI, exactly as without a file. A section key with nothing under it (`profiles:` alone) fails startup: leave the key out instead. An unknown key fails startup with its line.
- **Declared sections are read-only.** The UI shows them disabled. The API answers `409 conflict`, naming the file, to every write to a declared section, a declared instance or the declared account, including the password change and `POST /setup/account`. GET responses report `from_config_file`. `kestrel reset-password` refuses a declared account. To change a declared value, change the file and restart.
- **A section dropped from the file keeps its last value** and is the UI's to change again.
- **Secrets are never in the file.** A secret field is given only as `<field>_env`, naming the environment variable that holds it. A secret written inline, an unset or empty variable, or a value that isn't a variable name fails startup.
- **Not in the file:** TRaSH's daily update (`trash.auto_update`) and the TMDB and TheTVDB key overrides stay in the UI. Use `KESTREL_TMDB_API_KEY` and `KESTREL_TVDB_API_KEY` for your own keys, and `KESTREL_API_KEY` for the API key.

### Sections

#### account

Created when there is none. The username is set from the file, and the password from its variable on every start. A password that changes ends the admin's sessions and leaves the Requesters' alone.

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| `username`     | The admin's username.                             |
| `password_env` | The name of the variable that holds the password. |

#### language_region

A new Primary Language re-scores the files, as it does in Settings.

| Field                  | Value                                |
| ---------------------- | ------------------------------------ |
| `primary_language`     | `en`, `de` or `fr`.                  |
| `release_date_country` | A two-letter uppercase country code. |

#### root_folders

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| `movies` | A list of folders. The first is the default. |
| `series` | A list of folders. The first is the default. |

Every folder must exist and be writable.

#### profiles

List all six Profiles or none: `hd-primary`, `hd-original`, `any-primary`, `any-original`, `4k-primary` and `4k-original`. Each takes all four fields.

| Field               | Value                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | `true` or `false`.                                                                                                                                                                                                                                                              |
| `original_language` | What the Profile does with a Release that has the Title's Original Language but no Primary-Language audio: `reject`, `offer` it for approval in Needs attention, or `accept`. The older `original_fallback` still works in its place (`true` is `accept`, `false` is `reject`). |
| `default_movies`    | `true` if new Movies get this Profile for its Slot.                                                                                                                                                                                                                             |
| `default_series`    | `true` if new Series get this Profile for its Slot.                                                                                                                                                                                                                             |

The rules of Settings > Profiles hold across the six:

- An Original-Language Profile (`*-original`) always rejects.
- A default must be enabled.
- A Slot has at most one default per kind.
- The Standard Slot has exactly one default for Movies and one for Series. The 4K Slot may have none.

#### plugin_instances

A plugin instance is one connection to a service: your download client, an indexer, a media server, Plex or Silo. Each entry takes:

| Field       | Value                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `name`      | The instance's name. The file knows instances by name.                                                  |
| `plugin_id` | `sabnzbd`, `newznab`, `jellyfin`, `plex` or `silo`.                                                     |
| `enabled`   | Optional. A new instance starts enabled when the file leaves it out. [Details](#plugin-instance-rules). |
| `priority`  | Optional, default `0`. Lower wins a tie between otherwise equal Releases.                               |
| `config`    | The plugin's fields. The plugin's defaults fill the ones you leave out.                                 |

The fields of `config` (give a secret as `<field>_env`):

| `plugin_id` | Fields                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sabnzbd`   | `url`, `api_key` (secret), `movie_category` (default `movies`), `tv_category` (default `tv`)                                                  |
| `newznab`   | `url`, `api_key` (secret), `movie_categories` (default `2000`), `tv_categories` (default `5000`), `api_requests_per_day` (empty for no limit) |
| `jellyfin`  | `url`, `api_key` (secret)                                                                                                                     |
| `plex`      | `url`, `token` (secret)                                                                                                                       |
| `silo`      | `url`, `api_key` (secret, the admin API key)                                                                                                  |

After applying the file, Kestrel tests the connection of each enabled declared instance. An instance that can't connect at startup is only logged as a warning, and Kestrel starts anyway.

#### reverse_proxy

All three fields, checked as in Settings > Reverse proxy.

| Field             | Value                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trusted_proxies` | Addresses or ranges Kestrel believes `X-Forwarded-For` and `X-Forwarded-Proto` from, so the login throttle counts each client behind the proxy on its own. |
| `enabled`         | Adds login from `header`. Needs at least one trusted proxy. Keep it `false` unless an SSO portal sets the header.                                          |
| `header`          | The header that carries the username, such as `Remote-User`.                                                                                               |

Kestrel no longer believes `X-Forwarded-Proto` from an address outside `trusted_proxies`. If you upgrade, and a proxy that ends TLS sits in front of Kestrel with `trusted_proxies` empty, the session cookie used to get its `Secure` flag from that header and now silently doesn't. List the proxy in `trusted_proxies` (here or in Settings > Reverse proxy), with `enabled: false` if you want no header login.

#### plex_sign_in

Lets people who share your Plex server make Requests. [Requesters](#requesters-plex-sign-in) explains the feature. Applied after the plugin instances and the root folders. Checked with the rules of `PUT /settings/plex-sign-in`, against the instances and root folders the file declares.

| Field               | Value                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | `true` or `false`.                                                                                                                           |
| `instance`          | Needed when `enabled` is `true`: the name of a `plex` plugin instance, declared in the same file or made in the UI.                          |
| `users`             | Optional. Plex usernames, unique ignoring case. Leave it out or empty for everyone with access.                                              |
| `user_root_folders` | Optional. A map from a Plex user to `movies` and `series`, each optional and one of that kind's root folders. Keys are unique ignoring case. |
| `watchlist`         | Optional, off until set. Requests from Plex Watchlists ([ADR 0019](../adr/0019-requests-from-plex-watchlists.md)).                           |
| `watch_ahead`       | Optional, off until set. A Requester's Series Request starts with season 1.                                                                  |
| `labels`            | Optional, off until set. Labels and a collection for requested Titles in Plex.                                                               |
| `poster_badge`      | Optional, off until set. A "Requested" badge on posters in Plex.                                                                             |
| `poster_badge_days` | Optional whole number, at least 1. Default 30.                                                                                               |

#### silo

[Watch-ahead for Silo](#watch-ahead-for-silo) explains the feature ([ADR 0020](../adr/0020-watch-ahead-for-silo.md)). Applied after the plugin instances. Checked with the rules of `PUT /settings/silo`, against the instances the file declares.

| Field         | Value                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `watch_ahead` | Optional, off until set.                                                                                                |
| `instance`    | The name of a `silo` plugin instance, declared in the same file or made in the UI. Needed once `watch_ahead` is `true`. |

#### display

The household-wide view defaults. Name any of the keys: each one you name is read-only in Settings, and each you leave out stays the UI's. They are where a view starts. A sort picked in Manual search and the Upcoming filters changed in a session still win. ([ADR 0022](../adr/0022-declared-display-settings-may-leave-others-to-the-ui.md))

| Field                | Value                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `season_order`       | `oldest_first` or `newest_first`. Newest first reverses the seasons and the episodes in each. Specials come last either way.                                                                     |
| `seasons_open`       | Accepted and ignored. The Title page opens on one season, chosen from a season menu, so no season starts open or closed. Existing files that name it keep loading.                               |
| `manual_search_sort` | `best_first`, or a column and a direction such as `size_desc`. The columns are `score`, `release`, `quality`, `languages`, `formats`, `size`, `age` and `indexer`. `score_desc` is `best_first`. |
| `upcoming_filters`   | `kind` (`all`, `movie` or `series`), `wanted_only` and `hide_imported`. Declared as a whole: a filter you leave out takes its default (`all`, `false`, `false`).                                 |

#### check_github_updates

`true` or `false`. See [Updates](#updates).

### Plugin instance rules

These rules matter once you move between the UI and the file, or rename an instance.

- **Instances are known by name.** A name is declared once. A declared instance is created when missing and updated in place when it differs.
- **Renaming deletes.** Renaming an instance in the file, or changing its `plugin_id`, deletes it and creates a new one. Don't rename a download client while Grabs are in flight. A Grab belongs to the instance it was sent to, and the new one is a different instance.
- **Removing deletes.** An instance removed from the file is deleted on the next start. `plugin_instances: []` declares none, and deletes the instances the file declared before. Leaving `plugin_instances` out instead hands its instances back to the UI, and once the section returns they count as instances created in the UI.
- **The UI's own instances are never touched.** The exception is the first start that declares a name: an instance created in the UI with that exact name and the same plugin is taken over instead of duplicated. A name the UI uses for another plugin, or for two instances, fails startup.
- **What the UI can do with a declared instance:** test it, and switch it on and off when the file leaves its `enabled` out (Kestrel keeps that value across restarts). It can't change or remove it. Creating or renaming an instance in the UI to a declared name answers `409 conflict`. Instances created in the UI may still share names with each other ([ADR 0015](../adr/0015-declared-instances-may-leave-enabled-to-the-ui.md)).
- **An `enabled` the file sets is enforced.** Switching that instance off is a file change and a restart, and a toggle in the UI answers `409 conflict`.
- **One download client may be enabled.** A file that would exceed a plugin contract's cap on enabled instances fails startup. Kestrel counts the enabled instances created in the UI and the stored `enabled` of declared instances whose `enabled` the file leaves out.

## Requesters (Plex sign-in)

People who share your Plex server can ask for Movies and Series in Kestrel, without an app like Seerr in front of it ([ADR 0018](../adr/0018-requesters-sign-in-with-plex.md)). Switch it on in Settings > Plex (or declare `plex_sign_in` in the Config File) and pick the Plex instance whose server and owner token decide who may sign in.

The login page then offers "Sign in with Plex". Kestrel sends the browser to plex.tv, plex.tv sends it back to Kestrel's login page with `?plex=1`, and Kestrel finishes the sign-in there. Only the browser that started a sign-in can finish it.

- **Who may sign in:** the server's owner, members of the owner's Plex Home, and friends whose share includes this server, read with the owner's token from the Plex instance. A list of `users` narrows that to those Plex usernames (or names, for a Home user without one), ignoring case. The Requester's own Plex token is used once, to learn who they are, and never stored.
- **What a Requester can do:** search Titles, make a Request and see their own Requests, and nothing else. Every other route answers `403 forbidden`. A Request asks for the Standard Slot under Profile resolution and goes in the kind's first root folder, unless `user_root_folders` names another for that user. It shows up in Requests and in the Log like any other, with the source `plex`.
- **Switches:** Settings > Plex (or `plex_sign_in` in the Config File) also holds four switches for what Kestrel does with the Plex server. Each is off until set and works only while Plex sign-in is on.
  - `watchlist` makes Requests from the Watchlists of the owner and of friends who may request.
  - `watch_ahead` makes a Requester's Series Request start with season 1, and adds the next season once anyone has watched 2 episodes of the newest. It counts plays on the Plex server, and on Silo too (see below).
  - `labels` marks requested Titles in Plex with labels and a collection.
  - `poster_badge` stamps a "Requested" badge on their posters for `poster_badge_days` days (30 unless set).
- **Sessions:** a Requester's session lasts 30 days from the last use, like the admin's. At most once an hour it is checked again against the owner's list. It ends when the account lost access, left `users`, or Plex sign-in was switched off. A plex.tv outage does not end sessions. Changing the admin password ends the other admin sessions only. "Log out everywhere" ends every session.
- **Network:** Kestrel calls plex.tv (`https://plex.tv`) to create and read PINs, learn an account and read the owner's shared users. It identifies itself with a client identifier it generates once per instance. Kestrel needs outbound access to plex.tv, and the browser needs to reach `https://app.plex.tv`.
- **Behind a TLS proxy:** the redirect back to Kestrel is built from the request: `https` when the request is secure, the `Host` header and the base URL. List the proxy in `trusted_proxies` (Settings > Reverse proxy, or `reverse_proxy` in the Config File), so Kestrel believes its `X-Forwarded-Proto` and `X-Forwarded-For` and the session and PIN cookies get `Secure`. The proxy must pass the `Host` header on unchanged.

## Watch-ahead for Silo

A Series requested in Silo can come one season at a time too ([ADR 0020](../adr/0020-watch-ahead-for-silo.md)). Switch Watch-ahead on in Settings > Silo (or declare `silo` in the Config File), and pick the Silo instance whose playback history Kestrel reads, with that media server's admin API key.

A Silo Series Request that names no seasons then starts with season 1. Kestrel adds the next season once anyone, on any Silo account or profile, has watched 2 episodes of the newest one it holds. Plays on the Plex server (when `plex_sign_in` has `watch_ahead` on) and on Silo count together.

- **Per request:** `watch_ahead` is the default. The Silo plugin's Watch-ahead option (Kestrel default, On or Off, also per Silo request route) sends `watch_ahead` with the Request and overrides it. The same field in `POST /requests` works for any source. Left out, every source but Silo asks for the whole Series.
- **Seasons asked for in Silo:** a Silo user who requests the remaining seasons themselves gets them at once.

## Telling Silo about changed Title folders through Autoscan

The Silo plugin (`kestrel-silo`) can tell Silo which Title folders Kestrel changed, so Silo scans a new Import without the Silo media-server instance. The plugin's Kestrel Title folders scan source polls Kestrel's folder changes and hands Silo Autoscan the folders as paths. Kestrel keeps 30 days of changes and the plugin keeps no state: Silo stores the marker it polled up to, so a change Kestrel has recorded is still there after a restart of Kestrel or Silo. Kestrel records a Title folder's change once it settles, about 10 seconds after the last change to it, the same moment it tells the media servers.

1. Install the Silo plugin and add its Kestrel connection (Kestrel's address and an API key from Settings), as in the plugin's setup steps.
2. In Silo, open Admin > Libraries > Autoscan, enable Autoscan and choose Add source > Kestrel Title folders.
3. Bind the Kestrel connection. The scan source needs one, and uses the same base URL and API key as the request router.
4. If Silo mounts the media at a different path than Kestrel, add a path rewrite on the source from Kestrel's Root folder to the library path in Silo. Without one, Silo skips a folder that matches none of its libraries.

- **When Silo sees an Import:** Silo's poll interval (Autoscan settings, 600 seconds by default) decides it. A per-source interval can only make a source poll less often. Silo scans a new or changed Title folder. For a deleted one, and the old folder of a rename, it scans the Root folder, so the missing items are marked missing; when the Root folder is a Silo library root, that is a scan of the whole library.
- **After a long gap:** if Silo polls with a marker older than 30 days, or one from another Kestrel, Kestrel cannot say what changed, and Silo scans every Root folder once.
- **The Silo media-server instance:** it keeps working. Once the scan source works in your Silo, the media-server instance is no longer needed for scans.
- **Older Kestrel:** the scan source reports "no folder-change feed" in Silo's Autoscan activity log. Update Kestrel to the release that matches the plugin.

## The API

The REST API, its API key and the `X-Api-Key` header are on the [API page](api.md).
